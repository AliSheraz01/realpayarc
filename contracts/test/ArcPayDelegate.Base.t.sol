// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ArcPayDelegate} from "../ArcPayDelegate.sol";
// Reuse the existing mock (not modified).
import {MockUSDC} from "./ArcPay.Base.t.sol";

abstract contract ArcPayDelegateTestBase is Test {
    ArcPayDelegate internal dp;
    MockUSDC internal usdc;

    address internal owner = makeAddr("owner");
    address internal relayer = makeAddr("relayer");
    address internal recipient = makeAddr("recipient");
    address internal other = makeAddr("other");

    uint256 internal constant T0 = 1_700_000_000;
    uint128 internal constant PER = 100e6;
    uint128 internal constant DAILY = 250e6;
    uint128 internal constant MAXFEE = 2e6;
    uint256 internal constant OWNER_BAL = 10_000e6;
    bytes32 internal constant MEMO = keccak256("memo");

    event DelegationSet(
        address indexed owner,
        address indexed relayer,
        uint128 perPaymentLimit,
        uint128 dailyLimit,
        uint64 expiry,
        uint128 maxFee
    );
    event DelegationRevoked(address indexed owner, address indexed relayer);
    event DelegatedPayment(
        address indexed from,
        address indexed to,
        address indexed relayer,
        uint256 amount,
        uint256 fee,
        bytes32 memo
    );

    function setUp() public virtual {
        vm.warp(T0);
        usdc = new MockUSDC();
        dp = new ArcPayDelegate(IERC20(address(usdc)));
        usdc.mint(owner, OWNER_BAL);
        vm.prank(owner);
        usdc.approve(address(dp), type(uint256).max);
    }

    /// @dev Default delegation: PER / DAILY, expires T0 + 30 days, maxFee MAXFEE.
    function _set() internal {
        _setFull(PER, DAILY, uint64(T0 + 30 days), MAXFEE);
    }

    /// @dev Delegation with maxFee == 0.
    function _setWith(uint128 p, uint128 d, uint64 e) internal {
        _setFull(p, d, e, 0);
    }

    function _setFull(uint128 p, uint128 d, uint64 e, uint128 m) internal {
        vm.prank(owner);
        dp.setDelegation(relayer, p, d, e, m);
    }

    /// @dev Pay with zero fee.
    function _pay(uint256 amt) internal {
        _payFee(amt, 0);
    }

    function _payFee(uint256 amt, uint256 fee) internal {
        vm.prank(relayer);
        dp.payFor(owner, recipient, amt, fee, MEMO);
    }

    function _remaining() internal view returns (uint256 r) {
        (,,,,, r) = dp.getDelegation(owner);
    }
}
