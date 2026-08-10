// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {AgentWorkEscrow} from "../src/AgentWorkEscrow.sol";

/// @notice Deploys AgentWorkEscrow to BOT Chain.
///
/// Usage:
///   forge script script/Deploy.s.sol:Deploy --rpc-url "$BOT_RPC_URL" --broadcast
///
/// Required env:
///   DEPLOYER_PRIVATE_KEY   funded with gas only
///   VERIFIER_SIGNER        public address of the verifier signing key
///   ESCROW_OWNER           optional; defaults to the deployer address
///   BOT_CHAIN_ID           optional; defaults to 677 (mainnet). 968 is the testnet.
contract Deploy is Script {
    function run() external returns (AgentWorkEscrow escrow) {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address verifierSigner = vm.envAddress("VERIFIER_SIGNER");
        address deployer = vm.addr(deployerKey);
        address owner = vm.envOr("ESCROW_OWNER", deployer);

        require(verifierSigner != address(0), "VERIFIER_SIGNER unset");

        // The check that matters is that the RPC we are broadcasting to is the chain the rest of
        // the config was written for — a mismatch produces an escrow whose EIP-712 domain separator
        // can never validate a decision, and the only fix is to deploy again. Pinning this to 677
        // outright would also make it impossible to rehearse on the testnet, so compare against the
        // configured id and default to mainnet when nothing is set.
        uint256 expected = vm.envOr("BOT_CHAIN_ID", uint256(677));
        require(
            block.chainid == expected,
            "chain id does not match BOT_CHAIN_ID (677 = mainnet, 968 = testnet)"
        );

        vm.startBroadcast(deployerKey);
        escrow = new AgentWorkEscrow(verifierSigner, owner);
        vm.stopBroadcast();

        console2.log("chainId          ", block.chainid);
        console2.log("AgentWorkEscrow  ", address(escrow));
        console2.log("verifierSigner   ", verifierSigner);
        console2.log("owner            ", owner);
        console2.log("domainSeparator  ");
        console2.logBytes32(escrow.domainSeparator());
    }
}

/// @notice Same deployment without the chain-id assertion, for local Anvil rehearsals.
contract DeployLocal is Script {
    function run() external returns (AgentWorkEscrow escrow) {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address verifierSigner = vm.envAddress("VERIFIER_SIGNER");
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);
        escrow = new AgentWorkEscrow(verifierSigner, deployer);
        vm.stopBroadcast();

        console2.log("AgentWorkEscrow  ", address(escrow));
    }
}
