// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title AgentWorkEscrow
/// @notice AI-gated escrow for agent work on BOT Chain.
/// @dev A buyer escrows native BOT against a brief hash. The provider records a delivery hash.
///      The BOTLatch verifier signs an EIP-712 `Decision` whose verdict drives settlement:
///      GO releases to the provider, NO_GO refunds the buyer, CAUTION locks the job until the
///      buyer resolves it. Deliveries never dictate the payout address, amount, or a call target.
///
///      Trust model: the owner may rotate `verifierSigner` (key-compromise path) but can never
///      move escrowed funds. Every payout target is fixed at job creation time.
contract AgentWorkEscrow is EIP712, ReentrancyGuard, Ownable2Step {
    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    enum Status {
        None,
        Funded,
        Delivered,
        Settled,
        Cancelled
    }

    enum Verdict {
        None,
        Go,
        Caution,
        NoGo
    }

    /// @dev Field order is chosen for storage packing; slots are
    ///      [buyer|createdAt|status|verdict] [provider|deliverBy] [amount] [briefHash] [deliveryHash].
    struct Job {
        address buyer;
        uint64 createdAt;
        Status status;
        Verdict verdict;
        address payable provider;
        uint64 deliverBy;
        uint128 amount;
        bytes32 briefHash;
        bytes32 deliveryHash;
    }

    struct Decision {
        uint256 jobId;
        bytes32 briefHash;
        bytes32 deliveryHash;
        bytes32 evidenceHash;
        Verdict verdict;
        uint64 validUntil;
    }

    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------

    bytes32 public constant DECISION_TYPEHASH = keccak256(
        "Decision(uint256 jobId,bytes32 briefHash,bytes32 deliveryHash,bytes32 evidenceHash,uint8 verdict,uint64 validUntil)"
    );

    /// @notice Upper bound on how far out a delivery deadline may be set.
    uint64 public constant MAX_DELIVERY_WINDOW = 365 days;

    /// @notice Upper bound on decision lifetime, enforced at settle time.
    /// @dev The verifier issues 10–15 minute decisions; this is a contract-side ceiling so a
    ///      leaked long-lived signature cannot be replayed days later.
    uint64 public constant MAX_DECISION_TTL = 1 hours;

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    /// @notice Address whose EIP-712 signature authorises settlement decisions.
    address public verifierSigner;

    /// @notice Total number of jobs ever created. Job ids start at 1.
    uint256 public jobCount;

    mapping(uint256 jobId => Job) private _jobs;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event JobCreated(
        uint256 indexed jobId,
        address indexed buyer,
        address indexed provider,
        uint256 amount,
        bytes32 briefHash,
        uint64 deliverBy
    );
    event DeliverySubmitted(uint256 indexed jobId, bytes32 deliveryHash);
    event DecisionApplied(
        uint256 indexed jobId, Verdict verdict, bytes32 evidenceHash, address indexed verifier
    );
    event PaymentReleased(uint256 indexed jobId, address indexed provider, uint256 amount);
    event BuyerRefunded(uint256 indexed jobId, address indexed buyer, uint256 amount);
    event CautionRaised(uint256 indexed jobId, bytes32 evidenceHash);
    event JobCancelled(uint256 indexed jobId, address indexed buyer, uint256 amount);
    event VerifierSignerUpdated(address indexed previousSigner, address indexed newSigner);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error ZeroAddress();
    error ZeroAmount();
    error AmountTooLarge();
    error EmptyBriefHash();
    error EmptyDeliveryHash();
    error InvalidDeadline();
    error UnknownJob();
    error NotProvider();
    error NotBuyer();
    error InvalidStatus(Status expected, Status actual);
    error DeadlinePassed();
    error DeadlineNotReached();
    error DecisionExpired();
    error DecisionTtlTooLong();
    error BriefHashMismatch();
    error DeliveryHashMismatch();
    error InvalidVerdict();
    error VerdictAlreadyApplied(Verdict applied);
    error NotCaution();
    error InvalidSignature();
    error TransferFailed();

    // ---------------------------------------------------------------------
    // Construction
    // ---------------------------------------------------------------------

    /// @param verifierSigner_ Public address of the BOTLatch verifier signing key.
    /// @param owner_ Owner allowed to rotate the verifier signer. Never able to move funds.
    constructor(address verifierSigner_, address owner_)
        EIP712("BOTLatch", "1")
        Ownable(owner_)
    {
        if (verifierSigner_ == address(0) || owner_ == address(0)) revert ZeroAddress();
        verifierSigner = verifierSigner_;
        emit VerifierSignerUpdated(address(0), verifierSigner_);
    }

    // ---------------------------------------------------------------------
    // Buyer / provider flow
    // ---------------------------------------------------------------------

    /// @notice Create a job and escrow `msg.value` native BOT for it.
    /// @param provider Wallet that will be paid on a GO verdict. Fixed for the life of the job.
    /// @param briefHash keccak256 of the canonical brief text held off-chain.
    /// @param deliverBy Unix timestamp after which the buyer may reclaim an undelivered job.
    /// @return jobId The new job id.
    function createJob(address payable provider, bytes32 briefHash, uint64 deliverBy)
        external
        payable
        returns (uint256 jobId)
    {
        if (provider == address(0) || provider == address(this)) revert ZeroAddress();
        if (msg.value == 0) revert ZeroAmount();
        if (msg.value > type(uint128).max) revert AmountTooLarge();
        if (briefHash == bytes32(0)) revert EmptyBriefHash();
        if (deliverBy <= block.timestamp || deliverBy > block.timestamp + MAX_DELIVERY_WINDOW) {
            revert InvalidDeadline();
        }

        unchecked {
            jobId = ++jobCount;
        }

        _jobs[jobId] = Job({
            buyer: msg.sender,
            createdAt: uint64(block.timestamp),
            status: Status.Funded,
            verdict: Verdict.None,
            provider: provider,
            deliverBy: deliverBy,
            amount: uint128(msg.value),
            briefHash: briefHash,
            deliveryHash: bytes32(0)
        });

        emit JobCreated(jobId, msg.sender, provider, msg.value, briefHash, deliverBy);
    }

    /// @notice Record the exact delivery that the verifier will evaluate.
    /// @dev Callable only by the assigned provider, only before the deadline, and only while no
    ///      verdict has been applied. Re-submission before a verdict replaces the delivery hash,
    ///      which invalidates any decision already signed for the previous delivery.
    function submitDelivery(uint256 jobId, bytes32 deliveryHash) external {
        Job storage job = _jobs[jobId];
        if (job.status == Status.None) revert UnknownJob();
        if (msg.sender != job.provider) revert NotProvider();
        if (job.status != Status.Funded && job.status != Status.Delivered) {
            revert InvalidStatus(Status.Funded, job.status);
        }
        if (job.verdict != Verdict.None) revert VerdictAlreadyApplied(job.verdict);
        if (deliveryHash == bytes32(0)) revert EmptyDeliveryHash();
        if (block.timestamp > job.deliverBy) revert DeadlinePassed();

        job.deliveryHash = deliveryHash;
        job.status = Status.Delivered;

        emit DeliverySubmitted(jobId, deliveryHash);
    }

    /// @notice Apply a verifier-signed decision and settle the job accordingly.
    /// @dev Permissionless: the signature is the authority, not the caller. This lets the buyer,
    ///      the provider, or a relayer push the same decision without changing the outcome.
    function settle(Decision calldata decision, bytes calldata signature) external nonReentrant {
        Job storage job = _jobs[decision.jobId];

        if (job.status == Status.None) revert UnknownJob();
        if (job.status != Status.Delivered) revert InvalidStatus(Status.Delivered, job.status);
        if (job.verdict != Verdict.None) revert VerdictAlreadyApplied(job.verdict);
        if (decision.verdict == Verdict.None) revert InvalidVerdict();
        if (decision.briefHash != job.briefHash) revert BriefHashMismatch();
        if (decision.deliveryHash != job.deliveryHash) revert DeliveryHashMismatch();
        if (block.timestamp > decision.validUntil) revert DecisionExpired();
        if (decision.validUntil > block.timestamp + MAX_DECISION_TTL) revert DecisionTtlTooLong();

        _requireVerifierSignature(decision, signature);

        job.verdict = decision.verdict;

        emit DecisionApplied(decision.jobId, decision.verdict, decision.evidenceHash, verifierSigner);

        if (decision.verdict == Verdict.Caution) {
            // Funds stay locked until the buyer resolves. Status remains Delivered.
            emit CautionRaised(decision.jobId, decision.evidenceHash);
            return;
        }

        // Effects before interaction: mark settled, then pay out.
        job.status = Status.Settled;
        uint256 amount = job.amount;

        if (decision.verdict == Verdict.Go) {
            address provider = job.provider;
            _pay(provider, amount);
            emit PaymentReleased(decision.jobId, provider, amount);
        } else {
            address buyer = job.buyer;
            _pay(buyer, amount);
            emit BuyerRefunded(decision.jobId, buyer, amount);
        }
    }

    /// @notice Resolve a job the verifier flagged as CAUTION.
    /// @param release True to pay the provider, false to refund the buyer.
    function resolveCaution(uint256 jobId, bool release) external nonReentrant {
        Job storage job = _jobs[jobId];

        if (job.status == Status.None) revert UnknownJob();
        if (msg.sender != job.buyer) revert NotBuyer();
        if (job.verdict != Verdict.Caution) revert NotCaution();
        if (job.status != Status.Delivered) revert InvalidStatus(Status.Delivered, job.status);

        job.status = Status.Settled;
        uint256 amount = job.amount;

        if (release) {
            address provider = job.provider;
            _pay(provider, amount);
            emit PaymentReleased(jobId, provider, amount);
        } else {
            address buyer = job.buyer;
            _pay(buyer, amount);
            emit BuyerRefunded(jobId, buyer, amount);
        }
    }

    /// @notice Reclaim escrowed funds when the provider never delivered before the deadline.
    function cancelExpired(uint256 jobId) external nonReentrant {
        Job storage job = _jobs[jobId];

        if (job.status == Status.None) revert UnknownJob();
        if (msg.sender != job.buyer) revert NotBuyer();
        if (job.status != Status.Funded) revert InvalidStatus(Status.Funded, job.status);
        if (block.timestamp <= job.deliverBy) revert DeadlineNotReached();

        job.status = Status.Cancelled;
        uint256 amount = job.amount;
        address buyer = job.buyer;

        _pay(buyer, amount);

        emit JobCancelled(jobId, buyer, amount);
        emit BuyerRefunded(jobId, buyer, amount);
    }

    // ---------------------------------------------------------------------
    // Owner
    // ---------------------------------------------------------------------

    /// @notice Rotate the verifier signing key. Cannot touch escrowed funds.
    function setVerifierSigner(address newSigner) external onlyOwner {
        if (newSigner == address(0)) revert ZeroAddress();
        address previous = verifierSigner;
        verifierSigner = newSigner;
        emit VerifierSignerUpdated(previous, newSigner);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getJob(uint256 jobId) external view returns (Job memory job) {
        job = _jobs[jobId];
        if (job.status == Status.None) revert UnknownJob();
    }

    /// @notice EIP-712 struct hash for a decision, bound to this contract and `block.chainid`.
    function hashDecision(Decision calldata decision) public view returns (bytes32) {
        return _hashTypedDataV4(_structHash(decision));
    }

    /// @notice Recover the signer of a decision without applying it. Useful for pre-flight checks.
    function recoverDecisionSigner(Decision calldata decision, bytes calldata signature)
        external
        view
        returns (address signer)
    {
        (signer,,) = ECDSA.tryRecover(hashDecision(decision), signature);
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    function _structHash(Decision calldata decision) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                DECISION_TYPEHASH,
                decision.jobId,
                decision.briefHash,
                decision.deliveryHash,
                decision.evidenceHash,
                uint8(decision.verdict),
                decision.validUntil
            )
        );
    }

    function _requireVerifierSignature(Decision calldata decision, bytes calldata signature)
        private
        view
    {
        (address signer, ECDSA.RecoverError err,) =
            ECDSA.tryRecover(hashDecision(decision), signature);
        if (err != ECDSA.RecoverError.NoError) revert InvalidSignature();
        if (signer != verifierSigner) revert InvalidSignature();
    }

    function _pay(address to, uint256 amount) private {
        (bool ok,) = payable(to).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
