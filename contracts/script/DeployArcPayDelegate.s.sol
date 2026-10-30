// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ArcPayDelegate} from "../ArcPayDelegate.sol";

/// @notice Foundry deployment of ArcPayDelegate (bot spending limits) to Arc.
/// @dev Same USDC predeploy on Arc Testnet (5042002) and Arc Mainnet (5042).
///   forge script contracts/script/DeployArcPayDelegate.s.sol --rpc-url $ARC_RPC_URL --broadcast --account <keystore>
contract DeployArcPayDelegate is Script {
    address internal constant ARC_USDC = 0x3600000000000000000000000000000000000000;

    function run() external returns (ArcPayDelegate delegate) {
        require(block.chainid == 5042 || block.chainid == 5042002, "DeployArcPayDelegate: not an Arc network");
        vm.startBroadcast();
        delegate = new ArcPayDelegate(IERC20(ARC_USDC));
        vm.stopBroadcast();
        require(address(delegate.USDC()) == ARC_USDC, "DeployArcPayDelegate: wrong USDC");
        console.log("ArcPayDelegate deployed at", address(delegate));
    }
}
