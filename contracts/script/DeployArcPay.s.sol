// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ArcPay} from "../ArcPay.sol";

/// @notice Foundry deployment of ArcPay to Arc.
/// @dev Arc Testnet (5042002) and Arc Mainnet (5042) share the same USDC predeploy address.
///   Dry run:   forge script contracts/script/DeployArcPay.s.sol --rpc-url $ARC_RPC_URL
///   Broadcast: forge script contracts/script/DeployArcPay.s.sol --rpc-url $ARC_RPC_URL --broadcast --account <keystore>
///   Prefer an encrypted keystore (`cast wallet import`) over a raw private key on mainnet.
contract DeployArcPay is Script {
    address internal constant ARC_USDC = 0x3600000000000000000000000000000000000000;

    function run() external returns (ArcPay arcPay) {
        require(block.chainid == 5042 || block.chainid == 5042002, "DeployArcPay: not an Arc network");
        console.log("Deploying ArcPay on chain", block.chainid);

        vm.startBroadcast();
        arcPay = new ArcPay(IERC20(ARC_USDC));
        vm.stopBroadcast();

        require(address(arcPay.USDC()) == ARC_USDC, "DeployArcPay: wrong USDC");
        console.log("ArcPay deployed at", address(arcPay));
    }
}
