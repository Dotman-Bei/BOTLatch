// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentWorkEscrow} from "../src/AgentWorkEscrow.sol";

/// @dev Shared fixture: deploys the escrow, holds the verifier key, and builds signed decisions.
abstract contract EscrowFixture is Test {
    AgentWorkEscrow internal escrow;

    uint256 internal constant VERIFIER_PK = 0xA11CE;
    uint256 internal constant ROGUE_PK = 0xBADBAD;

    address internal verifier;
    address internal rogue;
    address internal owner = address(0x0117);
    address internal buyer = address(0xB0B);
    address payable internal provider = payable(address(0xF00D));

    bytes32 internal constant BRIEF = keccak256("brief: summarise the BOT Chain docs");
    bytes32 internal constant DELIVERY = keccak256("delivery: a clean on-spec summary");
    bytes32 internal constant EVIDENCE = keccak256("evidence-object-v1");

    uint256 internal constant AMOUNT = 1 ether;

    function setUp() public virtual {
        verifier = vm.addr(VERIFIER_PK);
        rogue = vm.addr(ROGUE_PK);
        escrow = new AgentWorkEscrow(verifier, owner);

        vm.deal(buyer, 100 ether);
        vm.warp(1_800_000_000);
    }

    // -- helpers ----------------------------------------------------------

    function _deadline() internal view returns (uint64) {
        return uint64(block.timestamp + 7 days);
    }

    function _createJob() internal returns (uint256 jobId) {
        vm.prank(buyer);
        jobId = escrow.createJob{value: AMOUNT}(provider, BRIEF, _deadline());
    }

    function _createAndDeliver() internal returns (uint256 jobId) {
        jobId = _createJob();
        vm.prank(provider);
        escrow.submitDelivery(jobId, DELIVERY);
    }

    function _decision(uint256 jobId, AgentWorkEscrow.Verdict verdict)
        internal
        view
        returns (AgentWorkEscrow.Decision memory)
    {
        return AgentWorkEscrow.Decision({
            jobId: jobId,
            briefHash: BRIEF,
            deliveryHash: DELIVERY,
            evidenceHash: EVIDENCE,
            verdict: verdict,
            validUntil: uint64(block.timestamp + 10 minutes)
        });
    }

    /// @dev Makes an external staticcall to `hashDecision`, so it must never be inlined into the
    /// arguments of a call under `vm.expectRevert` — Solidity evaluates arguments first, and
    /// `expectRevert` binds to the very next call, which would be the (non-reverting) hash. Always
    /// hoist the signature into a local first.
    function _sign(AgentWorkEscrow.Decision memory decision, uint256 pk)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = escrow.hashDecision(decision);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _settle(AgentWorkEscrow.Decision memory decision, uint256 pk) internal {
        escrow.settle(decision, _sign(decision, pk));
    }
}

// =========================================================================
// Job creation
// =========================================================================

contract CreateJobTest is EscrowFixture {
    function test_createJob_escrowsFundsAndEmits() public {
        uint64 deadline = _deadline();

        vm.expectEmit(true, true, true, true);
        emit AgentWorkEscrow.JobCreated(1, buyer, provider, AMOUNT, BRIEF, deadline);

        vm.prank(buyer);
        uint256 jobId = escrow.createJob{value: AMOUNT}(provider, BRIEF, deadline);

        assertEq(jobId, 1);
        assertEq(address(escrow).balance, AMOUNT);
        assertEq(escrow.jobCount(), 1);

        AgentWorkEscrow.Job memory job = escrow.getJob(jobId);
        assertEq(job.buyer, buyer);
        assertEq(job.provider, provider);
        assertEq(job.amount, AMOUNT);
        assertEq(job.briefHash, BRIEF);
        assertEq(job.deliveryHash, bytes32(0));
        assertEq(uint8(job.status), uint8(AgentWorkEscrow.Status.Funded));
        assertEq(uint8(job.verdict), uint8(AgentWorkEscrow.Verdict.None));
    }

    function test_jobIdsIncrementFromOne() public {
        assertEq(_createJob(), 1);
        assertEq(_createJob(), 2);
        assertEq(_createJob(), 3);
    }

    function test_revert_zeroPayment() public {
        vm.prank(buyer);
        vm.expectRevert(AgentWorkEscrow.ZeroAmount.selector);
        escrow.createJob{value: 0}(provider, BRIEF, _deadline());
    }

    function test_revert_zeroProvider() public {
        vm.prank(buyer);
        vm.expectRevert(AgentWorkEscrow.ZeroAddress.selector);
        escrow.createJob{value: AMOUNT}(payable(address(0)), BRIEF, _deadline());
    }

    function test_revert_providerIsEscrow() public {
        vm.prank(buyer);
        vm.expectRevert(AgentWorkEscrow.ZeroAddress.selector);
        escrow.createJob{value: AMOUNT}(payable(address(escrow)), BRIEF, _deadline());
    }

    function test_revert_emptyBriefHash() public {
        vm.prank(buyer);
        vm.expectRevert(AgentWorkEscrow.EmptyBriefHash.selector);
        escrow.createJob{value: AMOUNT}(provider, bytes32(0), _deadline());
    }

    function test_revert_deadlineInPast() public {
        vm.prank(buyer);
        vm.expectRevert(AgentWorkEscrow.InvalidDeadline.selector);
        escrow.createJob{value: AMOUNT}(provider, BRIEF, uint64(block.timestamp - 1));
    }

    function test_revert_deadlineTooFarOut() public {
        vm.prank(buyer);
        vm.expectRevert(AgentWorkEscrow.InvalidDeadline.selector);
        escrow.createJob{value: AMOUNT}(provider, BRIEF, uint64(block.timestamp + 366 days));
    }

    function test_revert_getUnknownJob() public {
        vm.expectRevert(AgentWorkEscrow.UnknownJob.selector);
        escrow.getJob(999);
    }

    function testFuzz_createJob_anyPositiveAmount(uint96 amount) public {
        vm.assume(amount > 0);
        vm.deal(buyer, amount);
        vm.prank(buyer);
        uint256 jobId = escrow.createJob{value: amount}(provider, BRIEF, _deadline());
        assertEq(escrow.getJob(jobId).amount, amount);
    }
}

// =========================================================================
// Delivery
// =========================================================================

contract SubmitDeliveryTest is EscrowFixture {
    function test_provider_submitsDelivery() public {
        uint256 jobId = _createJob();

        vm.expectEmit(true, false, false, true);
        emit AgentWorkEscrow.DeliverySubmitted(jobId, DELIVERY);

        vm.prank(provider);
        escrow.submitDelivery(jobId, DELIVERY);

        AgentWorkEscrow.Job memory job = escrow.getJob(jobId);
        assertEq(job.deliveryHash, DELIVERY);
        assertEq(uint8(job.status), uint8(AgentWorkEscrow.Status.Delivered));
    }

    function test_revert_nonProviderCannotDeliver() public {
        uint256 jobId = _createJob();
        vm.prank(buyer);
        vm.expectRevert(AgentWorkEscrow.NotProvider.selector);
        escrow.submitDelivery(jobId, DELIVERY);
    }

    function test_revert_emptyDeliveryHash() public {
        uint256 jobId = _createJob();
        vm.prank(provider);
        vm.expectRevert(AgentWorkEscrow.EmptyDeliveryHash.selector);
        escrow.submitDelivery(jobId, bytes32(0));
    }

    function test_revert_afterDeadline() public {
        uint256 jobId = _createJob();
        vm.warp(block.timestamp + 8 days);
        vm.prank(provider);
        vm.expectRevert(AgentWorkEscrow.DeadlinePassed.selector);
        escrow.submitDelivery(jobId, DELIVERY);
    }

    function test_revert_unknownJob() public {
        vm.prank(provider);
        vm.expectRevert(AgentWorkEscrow.UnknownJob.selector);
        escrow.submitDelivery(42, DELIVERY);
    }

    function test_resubmissionBeforeVerdictReplacesHash() public {
        uint256 jobId = _createAndDeliver();
        bytes32 revised = keccak256("delivery v2");

        vm.prank(provider);
        escrow.submitDelivery(jobId, revised);

        assertEq(escrow.getJob(jobId).deliveryHash, revised);
    }

    /// @dev Rule: "A decision for an old delivery cannot settle a revised delivery."
    function test_staleDecisionCannotSettleRevisedDelivery() public {
        uint256 jobId = _createAndDeliver();
        AgentWorkEscrow.Decision memory stale = _decision(jobId, AgentWorkEscrow.Verdict.Go);
        bytes memory sig = _sign(stale, VERIFIER_PK);

        vm.prank(provider);
        escrow.submitDelivery(jobId, keccak256("delivery v2"));

        vm.expectRevert(AgentWorkEscrow.DeliveryHashMismatch.selector);
        escrow.settle(stale, sig);
    }

    function test_revert_deliverAfterSettlement() public {
        uint256 jobId = _createAndDeliver();
        _settle(_decision(jobId, AgentWorkEscrow.Verdict.Go), VERIFIER_PK);

        vm.prank(provider);
        vm.expectRevert(
            abi.encodeWithSelector(
                AgentWorkEscrow.InvalidStatus.selector,
                AgentWorkEscrow.Status.Funded,
                AgentWorkEscrow.Status.Settled
            )
        );
        escrow.submitDelivery(jobId, keccak256("too late"));
    }

    function test_revert_deliverAfterCautionVerdict() public {
        uint256 jobId = _createAndDeliver();
        _settle(_decision(jobId, AgentWorkEscrow.Verdict.Caution), VERIFIER_PK);

        vm.prank(provider);
        vm.expectRevert(
            abi.encodeWithSelector(
                AgentWorkEscrow.VerdictAlreadyApplied.selector, AgentWorkEscrow.Verdict.Caution
            )
        );
        escrow.submitDelivery(jobId, keccak256("sneaky revision"));
    }
}

// =========================================================================
// Settlement — GO / NO_GO / CAUTION
// =========================================================================

contract SettleTest is EscrowFixture {
    function test_go_paysExactAmountToFixedProvider() public {
        uint256 jobId = _createAndDeliver();
        uint256 providerBefore = provider.balance;
        uint256 buyerBefore = buyer.balance;

        AgentWorkEscrow.Decision memory decision = _decision(jobId, AgentWorkEscrow.Verdict.Go);

        vm.expectEmit(true, true, false, true);
        emit AgentWorkEscrow.DecisionApplied(jobId, AgentWorkEscrow.Verdict.Go, EVIDENCE, verifier);
        vm.expectEmit(true, true, false, true);
        emit AgentWorkEscrow.PaymentReleased(jobId, provider, AMOUNT);

        _settle(decision, VERIFIER_PK);

        assertEq(provider.balance, providerBefore + AMOUNT);
        assertEq(buyer.balance, buyerBefore);
        assertEq(address(escrow).balance, 0);
        assertEq(uint8(escrow.getJob(jobId).status), uint8(AgentWorkEscrow.Status.Settled));
    }

    function test_noGo_refundsOnlyOriginalBuyer() public {
        uint256 jobId = _createAndDeliver();
        uint256 providerBefore = provider.balance;
        uint256 buyerBefore = buyer.balance;

        vm.expectEmit(true, true, false, true);
        emit AgentWorkEscrow.BuyerRefunded(jobId, buyer, AMOUNT);

        _settle(_decision(jobId, AgentWorkEscrow.Verdict.NoGo), VERIFIER_PK);

        assertEq(buyer.balance, buyerBefore + AMOUNT);
        assertEq(provider.balance, providerBefore);
        assertEq(address(escrow).balance, 0);
    }

    function test_caution_locksFunds() public {
        uint256 jobId = _createAndDeliver();

        vm.expectEmit(true, false, false, true);
        emit AgentWorkEscrow.CautionRaised(jobId, EVIDENCE);

        _settle(_decision(jobId, AgentWorkEscrow.Verdict.Caution), VERIFIER_PK);

        assertEq(address(escrow).balance, AMOUNT, "funds must stay escrowed");
        AgentWorkEscrow.Job memory job = escrow.getJob(jobId);
        assertEq(uint8(job.status), uint8(AgentWorkEscrow.Status.Delivered));
        assertEq(uint8(job.verdict), uint8(AgentWorkEscrow.Verdict.Caution));
    }

    function test_settleIsPermissionless() public {
        uint256 jobId = _createAndDeliver();
        AgentWorkEscrow.Decision memory decision = _decision(jobId, AgentWorkEscrow.Verdict.Go);
        bytes memory sig = _sign(decision, VERIFIER_PK);

        vm.prank(address(0xDEAD)); // arbitrary relayer
        escrow.settle(decision, sig);

        assertEq(provider.balance, AMOUNT);
    }

    // -- authorisation ----------------------------------------------------

    function test_revert_wrongSigner() public {
        uint256 jobId = _createAndDeliver();
        AgentWorkEscrow.Decision memory decision = _decision(jobId, AgentWorkEscrow.Verdict.Go);
        bytes memory sig = _sign(decision, ROGUE_PK);

        vm.expectRevert(AgentWorkEscrow.InvalidSignature.selector);
        escrow.settle(decision, sig);
    }

    function test_revert_malformedSignature() public {
        uint256 jobId = _createAndDeliver();
        AgentWorkEscrow.Decision memory decision = _decision(jobId, AgentWorkEscrow.Verdict.Go);

        vm.expectRevert(AgentWorkEscrow.InvalidSignature.selector);
        escrow.settle(decision, hex"1234");
    }

    /// @dev Tampering with any signed field must break recovery.
    function test_revert_tamperedEvidenceHash() public {
        uint256 jobId = _createAndDeliver();
        AgentWorkEscrow.Decision memory decision = _decision(jobId, AgentWorkEscrow.Verdict.Go);
        bytes memory sig = _sign(decision, VERIFIER_PK);

        decision.evidenceHash = keccak256("swapped evidence");

        vm.expectRevert(AgentWorkEscrow.InvalidSignature.selector);
        escrow.settle(decision, sig);
    }

    function test_revert_verdictUpgradedFromNoGoToGo() public {
        uint256 jobId = _createAndDeliver();
        AgentWorkEscrow.Decision memory decision = _decision(jobId, AgentWorkEscrow.Verdict.NoGo);
        bytes memory sig = _sign(decision, VERIFIER_PK);

        decision.verdict = AgentWorkEscrow.Verdict.Go;

        vm.expectRevert(AgentWorkEscrow.InvalidSignature.selector);
        escrow.settle(decision, sig);
    }

    // -- binding ----------------------------------------------------------

    /// @dev Rule: "A decision for job A cannot settle job B."
    function test_revert_crossJobReplay() public {
        uint256 jobA = _createAndDeliver();
        uint256 jobB = _createAndDeliver();

        AgentWorkEscrow.Decision memory forA = _decision(jobA, AgentWorkEscrow.Verdict.Go);
        bytes memory sig = _sign(forA, VERIFIER_PK);

        AgentWorkEscrow.Decision memory forB = forA;
        forB.jobId = jobB;

        vm.expectRevert(AgentWorkEscrow.InvalidSignature.selector);
        escrow.settle(forB, sig);
    }

    function test_revert_briefHashMismatch() public {
        uint256 jobId = _createAndDeliver();
        AgentWorkEscrow.Decision memory decision = _decision(jobId, AgentWorkEscrow.Verdict.Go);
        decision.briefHash = keccak256("a different brief");
        bytes memory sig = _sign(decision, VERIFIER_PK);

        vm.expectRevert(AgentWorkEscrow.BriefHashMismatch.selector);
        escrow.settle(decision, sig);
    }

    function test_revert_deliveryHashMismatch() public {
        uint256 jobId = _createAndDeliver();
        AgentWorkEscrow.Decision memory decision = _decision(jobId, AgentWorkEscrow.Verdict.Go);
        decision.deliveryHash = keccak256("a different delivery");
        bytes memory sig = _sign(decision, VERIFIER_PK);

        vm.expectRevert(AgentWorkEscrow.DeliveryHashMismatch.selector);
        escrow.settle(decision, sig);
    }

    /// @dev EIP-712 domain binds chain id; a signature from another chain must not verify.
    function test_revert_crossChainReplay() public {
        uint256 jobId = _createAndDeliver();
        AgentWorkEscrow.Decision memory decision = _decision(jobId, AgentWorkEscrow.Verdict.Go);

        bytes32 digestHere = escrow.hashDecision(decision);
        vm.chainId(1);
        bytes32 digestElsewhere = escrow.hashDecision(decision);
        assertTrue(digestHere != digestElsewhere, "domain must bind chain id");

        // A signature produced for chain 1 cannot settle back on the original chain.
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(VERIFIER_PK, digestElsewhere);
        vm.chainId(31337);
        vm.expectRevert(AgentWorkEscrow.InvalidSignature.selector);
        escrow.settle(decision, abi.encodePacked(r, s, v));
    }

    // -- timing -----------------------------------------------------------

    function test_revert_expiredDecision() public {
        uint256 jobId = _createAndDeliver();
        AgentWorkEscrow.Decision memory decision = _decision(jobId, AgentWorkEscrow.Verdict.Go);
        bytes memory sig = _sign(decision, VERIFIER_PK);

        vm.warp(block.timestamp + 11 minutes);

        vm.expectRevert(AgentWorkEscrow.DecisionExpired.selector);
        escrow.settle(decision, sig);
    }

    function test_settleSucceedsExactlyAtValidUntil() public {
        uint256 jobId = _createAndDeliver();
        AgentWorkEscrow.Decision memory decision = _decision(jobId, AgentWorkEscrow.Verdict.Go);
        bytes memory sig = _sign(decision, VERIFIER_PK);

        vm.warp(decision.validUntil);
        escrow.settle(decision, sig);

        assertEq(provider.balance, AMOUNT);
    }

    function test_revert_ttlBeyondContractCeiling() public {
        uint256 jobId = _createAndDeliver();
        AgentWorkEscrow.Decision memory decision = _decision(jobId, AgentWorkEscrow.Verdict.Go);
        decision.validUntil = uint64(block.timestamp + 2 hours);
        bytes memory sig = _sign(decision, VERIFIER_PK);

        vm.expectRevert(AgentWorkEscrow.DecisionTtlTooLong.selector);
        escrow.settle(decision, sig);
    }

    // -- state ------------------------------------------------------------

    /// @dev Rule: "A verdict cannot be replayed after settlement."
    function test_revert_replayAfterSettlement() public {
        uint256 jobId = _createAndDeliver();
        AgentWorkEscrow.Decision memory decision = _decision(jobId, AgentWorkEscrow.Verdict.Go);
        bytes memory sig = _sign(decision, VERIFIER_PK);

        escrow.settle(decision, sig);

        vm.expectRevert(
            abi.encodeWithSelector(
                AgentWorkEscrow.InvalidStatus.selector,
                AgentWorkEscrow.Status.Delivered,
                AgentWorkEscrow.Status.Settled
            )
        );
        escrow.settle(decision, sig);
    }

    function test_revert_secondVerdictAfterCaution() public {
        uint256 jobId = _createAndDeliver();
        _settle(_decision(jobId, AgentWorkEscrow.Verdict.Caution), VERIFIER_PK);

        AgentWorkEscrow.Decision memory upgrade = _decision(jobId, AgentWorkEscrow.Verdict.Go);
        bytes memory sig = _sign(upgrade, VERIFIER_PK);

        vm.expectRevert(
            abi.encodeWithSelector(
                AgentWorkEscrow.VerdictAlreadyApplied.selector, AgentWorkEscrow.Verdict.Caution
            )
        );
        escrow.settle(upgrade, sig);
    }

    function test_revert_settleBeforeDelivery() public {
        uint256 jobId = _createJob();
        AgentWorkEscrow.Decision memory decision = _decision(jobId, AgentWorkEscrow.Verdict.Go);
        bytes memory sig = _sign(decision, VERIFIER_PK);

        vm.expectRevert(
            abi.encodeWithSelector(
                AgentWorkEscrow.InvalidStatus.selector,
                AgentWorkEscrow.Status.Delivered,
                AgentWorkEscrow.Status.Funded
            )
        );
        escrow.settle(decision, sig);
    }

    function test_revert_noneVerdict() public {
        uint256 jobId = _createAndDeliver();
        AgentWorkEscrow.Decision memory decision = _decision(jobId, AgentWorkEscrow.Verdict.None);
        bytes memory sig = _sign(decision, VERIFIER_PK);

        vm.expectRevert(AgentWorkEscrow.InvalidVerdict.selector);
        escrow.settle(decision, sig);
    }

    function test_revert_unknownJob() public {
        AgentWorkEscrow.Decision memory decision = _decision(777, AgentWorkEscrow.Verdict.Go);
        bytes memory sig = _sign(decision, VERIFIER_PK);

        vm.expectRevert(AgentWorkEscrow.UnknownJob.selector);
        escrow.settle(decision, sig);
    }

    function test_recoverDecisionSigner_matchesVerifier() public {
        uint256 jobId = _createAndDeliver();
        AgentWorkEscrow.Decision memory decision = _decision(jobId, AgentWorkEscrow.Verdict.Go);
        assertEq(escrow.recoverDecisionSigner(decision, _sign(decision, VERIFIER_PK)), verifier);
    }
}

// =========================================================================
// CAUTION resolution
// =========================================================================

contract ResolveCautionTest is EscrowFixture {
    uint256 internal jobId;

    function setUp() public override {
        super.setUp();
        jobId = _createAndDeliver();
        _settle(_decision(jobId, AgentWorkEscrow.Verdict.Caution), VERIFIER_PK);
    }

    function test_buyerReleases() public {
        uint256 before = provider.balance;
        vm.prank(buyer);
        escrow.resolveCaution(jobId, true);

        assertEq(provider.balance, before + AMOUNT);
        assertEq(address(escrow).balance, 0);
        assertEq(uint8(escrow.getJob(jobId).status), uint8(AgentWorkEscrow.Status.Settled));
    }

    function test_buyerRefunds() public {
        uint256 before = buyer.balance;
        vm.prank(buyer);
        escrow.resolveCaution(jobId, false);

        assertEq(buyer.balance, before + AMOUNT);
        assertEq(address(escrow).balance, 0);
    }

    /// @dev Rule: "CAUTION cannot move funds until the buyer resolves it."
    function test_revert_providerCannotSelfRelease() public {
        vm.prank(provider);
        vm.expectRevert(AgentWorkEscrow.NotBuyer.selector);
        escrow.resolveCaution(jobId, true);
        assertEq(address(escrow).balance, AMOUNT);
    }

    function test_revert_strangerCannotResolve() public {
        vm.prank(address(0xDEAD));
        vm.expectRevert(AgentWorkEscrow.NotBuyer.selector);
        escrow.resolveCaution(jobId, false);
    }

    function test_revert_ownerCannotResolve() public {
        vm.prank(owner);
        vm.expectRevert(AgentWorkEscrow.NotBuyer.selector);
        escrow.resolveCaution(jobId, true);
    }

    function test_revert_doubleResolve() public {
        vm.startPrank(buyer);
        escrow.resolveCaution(jobId, true);
        vm.expectRevert(
            abi.encodeWithSelector(
                AgentWorkEscrow.InvalidStatus.selector,
                AgentWorkEscrow.Status.Delivered,
                AgentWorkEscrow.Status.Settled
            )
        );
        escrow.resolveCaution(jobId, true);
        vm.stopPrank();
    }

    function test_revert_resolveJobWithoutCaution() public {
        uint256 clean = _createAndDeliver();
        vm.prank(buyer);
        vm.expectRevert(AgentWorkEscrow.NotCaution.selector);
        escrow.resolveCaution(clean, true);
    }

    function test_revert_unknownJob() public {
        vm.prank(buyer);
        vm.expectRevert(AgentWorkEscrow.UnknownJob.selector);
        escrow.resolveCaution(555, true);
    }
}

// =========================================================================
// Expiry
// =========================================================================

contract CancelExpiredTest is EscrowFixture {
    function test_buyerReclaimsAfterDeadline() public {
        uint256 jobId = _createJob();
        uint256 before = buyer.balance;

        vm.warp(block.timestamp + 8 days);

        vm.expectEmit(true, true, false, true);
        emit AgentWorkEscrow.JobCancelled(jobId, buyer, AMOUNT);

        vm.prank(buyer);
        escrow.cancelExpired(jobId);

        assertEq(buyer.balance, before + AMOUNT);
        assertEq(uint8(escrow.getJob(jobId).status), uint8(AgentWorkEscrow.Status.Cancelled));
    }

    function test_revert_beforeDeadline() public {
        uint256 jobId = _createJob();
        vm.prank(buyer);
        vm.expectRevert(AgentWorkEscrow.DeadlineNotReached.selector);
        escrow.cancelExpired(jobId);
    }

    function test_revert_exactlyAtDeadline() public {
        uint256 jobId = _createJob();
        vm.warp(escrow.getJob(jobId).deliverBy);
        vm.prank(buyer);
        vm.expectRevert(AgentWorkEscrow.DeadlineNotReached.selector);
        escrow.cancelExpired(jobId);
    }

    /// @dev Rule: reclaim is allowed "only when no delivery exists".
    function test_revert_whenDeliveryExists() public {
        uint256 jobId = _createAndDeliver();
        vm.warp(block.timestamp + 8 days);

        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(
                AgentWorkEscrow.InvalidStatus.selector,
                AgentWorkEscrow.Status.Funded,
                AgentWorkEscrow.Status.Delivered
            )
        );
        escrow.cancelExpired(jobId);
    }

    function test_revert_nonBuyer() public {
        uint256 jobId = _createJob();
        vm.warp(block.timestamp + 8 days);
        vm.prank(provider);
        vm.expectRevert(AgentWorkEscrow.NotBuyer.selector);
        escrow.cancelExpired(jobId);
    }

    function test_revert_doubleCancel() public {
        uint256 jobId = _createJob();
        vm.warp(block.timestamp + 8 days);
        vm.startPrank(buyer);
        escrow.cancelExpired(jobId);
        vm.expectRevert(
            abi.encodeWithSelector(
                AgentWorkEscrow.InvalidStatus.selector,
                AgentWorkEscrow.Status.Funded,
                AgentWorkEscrow.Status.Cancelled
            )
        );
        escrow.cancelExpired(jobId);
        vm.stopPrank();
    }
}

// =========================================================================
// Verifier signer administration
// =========================================================================

contract VerifierSignerTest is EscrowFixture {
    function test_ownerRotatesSigner() public {
        vm.prank(owner);
        escrow.setVerifierSigner(rogue);
        assertEq(escrow.verifierSigner(), rogue);
    }

    function test_rotatedSignerCanSettle_oldCannot() public {
        uint256 jobId = _createAndDeliver();
        vm.prank(owner);
        escrow.setVerifierSigner(rogue);

        AgentWorkEscrow.Decision memory decision = _decision(jobId, AgentWorkEscrow.Verdict.Go);
        bytes memory staleSig = _sign(decision, VERIFIER_PK);
        bytes memory rotatedSig = _sign(decision, ROGUE_PK);

        vm.expectRevert(AgentWorkEscrow.InvalidSignature.selector);
        escrow.settle(decision, staleSig);

        escrow.settle(decision, rotatedSig);
        assertEq(provider.balance, AMOUNT);
    }

    function test_revert_nonOwnerRotate() public {
        vm.prank(buyer);
        vm.expectRevert();
        escrow.setVerifierSigner(rogue);
    }

    function test_revert_rotateToZero() public {
        vm.prank(owner);
        vm.expectRevert(AgentWorkEscrow.ZeroAddress.selector);
        escrow.setVerifierSigner(address(0));
    }

    /// @dev The owner has no custody path: no function can move escrowed funds to them.
    function test_ownerCannotDrainEscrow() public {
        _createJob();
        assertEq(address(escrow).balance, AMOUNT);

        vm.prank(owner);
        (bool ok,) = address(escrow).call{value: 0}(abi.encodeWithSignature("withdraw()"));
        assertFalse(ok, "no withdraw path may exist");
        assertEq(address(escrow).balance, AMOUNT);
    }

    function test_revert_constructorZeroVerifier() public {
        vm.expectRevert(AgentWorkEscrow.ZeroAddress.selector);
        new AgentWorkEscrow(address(0), owner);
    }
}

// =========================================================================
// Reentrancy
// =========================================================================

/// @dev Malicious provider that tries to re-enter settle/resolveCaution during payout.
contract ReentrantProvider {
    AgentWorkEscrow public immutable escrow;
    AgentWorkEscrow.Decision public decision;
    bytes public signature;
    bool public attempted;
    bool public reenterSucceeded;

    constructor(AgentWorkEscrow escrow_) {
        escrow = escrow_;
    }

    function arm(AgentWorkEscrow.Decision calldata decision_, bytes calldata signature_) external {
        decision = decision_;
        signature = signature_;
    }

    function deliver(uint256 jobId, bytes32 deliveryHash) external {
        escrow.submitDelivery(jobId, deliveryHash);
    }

    receive() external payable {
        if (attempted) return;
        attempted = true;
        try escrow.settle(decision, signature) {
            reenterSucceeded = true;
        } catch {}
    }
}

contract ReentrancyTest is EscrowFixture {
    function test_reentrantProviderCannotDoublePay() public {
        ReentrantProvider attacker = new ReentrantProvider(escrow);

        vm.prank(buyer);
        uint256 jobId =
            escrow.createJob{value: AMOUNT}(payable(address(attacker)), BRIEF, _deadline());

        attacker.deliver(jobId, DELIVERY);

        AgentWorkEscrow.Decision memory decision = _decision(jobId, AgentWorkEscrow.Verdict.Go);
        bytes memory sig = _sign(decision, VERIFIER_PK);
        attacker.arm(decision, sig);

        // Fund a second job so the escrow holds extra balance the attacker could try to steal.
        _createJob();
        uint256 escrowBalanceBefore = address(escrow).balance;

        escrow.settle(decision, sig);

        assertTrue(attacker.attempted(), "reentrancy path should have been exercised");
        assertFalse(attacker.reenterSucceeded(), "reentrant settle must fail");
        assertEq(address(attacker).balance, AMOUNT, "attacker paid exactly once");
        assertEq(address(escrow).balance, escrowBalanceBefore - AMOUNT, "other job untouched");
    }

    function test_payoutToRejectingContractReverts() public {
        RejectingProvider rejector = new RejectingProvider();

        vm.prank(buyer);
        uint256 jobId =
            escrow.createJob{value: AMOUNT}(payable(address(rejector)), BRIEF, _deadline());

        vm.prank(address(rejector));
        escrow.submitDelivery(jobId, DELIVERY);

        AgentWorkEscrow.Decision memory decision = _decision(jobId, AgentWorkEscrow.Verdict.Go);
        bytes memory sig = _sign(decision, VERIFIER_PK);

        vm.expectRevert(AgentWorkEscrow.TransferFailed.selector);
        escrow.settle(decision, sig);

        // Job stays settleable; funds remain escrowed rather than being lost.
        assertEq(address(escrow).balance, AMOUNT);
        assertEq(uint8(escrow.getJob(jobId).status), uint8(AgentWorkEscrow.Status.Delivered));
    }
}

contract RejectingProvider {
    receive() external payable {
        revert("no thanks");
    }
}

// =========================================================================
// Solvency invariant
// =========================================================================

contract SolvencyTest is EscrowFixture {
    /// @dev Escrow balance must always equal the sum of unsettled job amounts.
    function test_balanceTracksOpenJobs() public {
        uint256 a = _createAndDeliver();
        uint256 b = _createAndDeliver();
        uint256 c = _createJob();

        assertEq(address(escrow).balance, 3 * AMOUNT);

        _settle(_decision(a, AgentWorkEscrow.Verdict.Go), VERIFIER_PK);
        assertEq(address(escrow).balance, 2 * AMOUNT);

        _settle(_decision(b, AgentWorkEscrow.Verdict.Caution), VERIFIER_PK);
        assertEq(address(escrow).balance, 2 * AMOUNT, "caution keeps funds");

        vm.prank(buyer);
        escrow.resolveCaution(b, false);
        assertEq(address(escrow).balance, AMOUNT);

        vm.warp(block.timestamp + 8 days);
        vm.prank(buyer);
        escrow.cancelExpired(c);
        assertEq(address(escrow).balance, 0);
    }

    function test_escrowRejectsBarePayments() public {
        vm.deal(address(0xCAFE), 1 ether);
        vm.prank(address(0xCAFE));
        (bool ok,) = address(escrow).call{value: 1 ether}("");
        assertFalse(ok, "no receive/fallback should accept stray value");
    }
}
