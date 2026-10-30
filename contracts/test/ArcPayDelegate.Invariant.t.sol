// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ArcPayDelegate} from "../ArcPayDelegate.sol";
import {MockUSDC} from "./ArcPay.Base.t.sol";

/// Drives the delegate as the relayer and keeps an independent model of the window.
contract ArcPayDelegateHandler is Test {
    ArcPayDelegate public dp;
    MockUSDC public usdc;
    address public immutable owner;
    address[3] public recipients;

    // model
    bool public active;
    uint256 public per;
    uint256 public daily;
    uint256 public maxFee;
    uint256 public expiry;
    uint256 public wStart; // 0 = unused
    uint256 public wSpent;
    bool public mismatch; // model disagreed with the contract about success
    uint256 public totalPaid;
    uint256 public totalFees;
    uint256 public feesInWindow;
    bool public feeBoundBroken; // a fee above maxFee was ever accepted
    uint256 public payCount;

    constructor(ArcPayDelegate _dp, MockUSDC _usdc, address _owner) {
        dp = _dp;
        usdc = _usdc;
        owner = _owner;
        recipients[0] = makeAddr("r0");
        recipients[1] = makeAddr("r1");
        recipients[2] = makeAddr("r2");
    }

    function setDelegation(uint256 p, uint256 d, uint256 expOff, uint256 mf) external {
        p = bound(p, 1, 500e6);
        d = bound(d, p, 1_000e6);
        expOff = bound(expOff, 1, 90 days);
        mf = bound(mf, 0, p);
        vm.prank(owner);
        dp.setDelegation(address(this), uint128(p), uint128(d), uint64(block.timestamp + expOff), uint128(mf));
        active = true;
        per = p;
        daily = d;
        expiry = block.timestamp + expOff;
        maxFee = mf;
        wStart = 0;
        wSpent = 0;
        feesInWindow = 0;
    }

    function revoke() external {
        if (!active) return;
        vm.prank(owner);
        dp.revokeDelegation();
        active = false;
    }

    function warp(uint256 dt) external {
        dt = bound(dt, 0, 2 days);
        vm.warp(block.timestamp + dt);
    }

    function pay(uint256 amount, uint256 fee, uint256 toSeed) external {
        amount = bound(amount, 0, per + per / 2 + 1);
        fee = bound(fee, 0, maxFee + 1);
        address to = recipients[toSeed % 3];

        bool fresh = wStart == 0 || block.timestamp >= wStart + 1 days;
        uint256 spentNow = fresh ? 0 : wSpent;
        bool expectOk = active && block.timestamp <= expiry && amount > 0 && fee <= maxFee
            && amount + fee <= per && spentNow + amount + fee <= daily;

        try dp.payFor(owner, to, amount, fee, bytes32(amount)) {
            if (!expectOk) mismatch = true;
            if (fresh) {
                wStart = block.timestamp;
                wSpent = 0;
                feesInWindow = 0;
            }
            if (fee > maxFee) feeBoundBroken = true;
            wSpent += amount + fee;
            feesInWindow += fee;
            totalFees += fee;
            totalPaid += amount;
            payCount++;
        } catch {
            if (expectOk) mismatch = true;
        }
    }

    /// @dev Remaining the contract should report right now according to the model.
    function modelRemaining() external view returns (uint256) {
        if (!active || block.timestamp > expiry) return 0;
        if (wStart == 0 || block.timestamp >= wStart + 1 days) return daily;
        return daily - wSpent;
    }

    function recipientsSum() external view returns (uint256 s) {
        for (uint256 i = 0; i < 3; i++) {
            s += usdc.balanceOf(recipients[i]);
        }
    }
}

contract ArcPayDelegateInvariantTest is Test {
    ArcPayDelegate internal dp;
    MockUSDC internal usdc;
    ArcPayDelegateHandler internal handler;
    address internal owner = makeAddr("owner");
    uint256 internal constant OWNER_BAL = 1_000_000_000e6;

    function setUp() public {
        vm.warp(1_700_000_000);
        usdc = new MockUSDC();
        dp = new ArcPayDelegate(IERC20(address(usdc)));
        handler = new ArcPayDelegateHandler(dp, usdc, owner);
        usdc.mint(owner, OWNER_BAL);
        vm.prank(owner);
        usdc.approve(address(dp), type(uint256).max);

        // start with an active delegation so pay() is exercised from the first call
        handler.setDelegation(100e6, 250e6, 30 days, 2e6);

        targetContract(address(handler));
        bytes4[] memory sels = new bytes4[](4);
        sels[0] = handler.pay.selector;
        sels[1] = handler.warp.selector;
        sels[2] = handler.setDelegation.selector;
        sels[3] = handler.revoke.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: sels}));
    }

    /// The contract never custodies funds.
    function invariant_ContractHoldsNoUsdc() public view {
        assertEq(usdc.balanceOf(address(dp)), 0);
    }

    /// spentInWindow <= dailyLimit, observed through remainingToday == daily - spent (never underflows,
    /// never exceeds dailyLimit) and equal to the independent model.
    function invariant_RemainingMatchesModelAndSpendWithinDaily() public view {
        (address r,, uint128 daily,,, uint256 rem) = dp.getDelegation(owner);
        assertLe(rem, daily);
        assertEq(rem, handler.modelRemaining());
        if (handler.active()) assertEq(r, address(handler));
        assertLe(handler.wSpent(), handler.daily());
    }

    /// Contract and model agree on every payment's success/failure.
    function invariant_NoModelMismatch() public view {
        assertFalse(handler.mismatch());
    }

    /// Funds are conserved between owner, recipients and the relayer (fee receiver).
    function invariant_BalancesConserved() public view {
        uint256 relayerBal = usdc.balanceOf(address(handler));
        assertEq(usdc.balanceOf(owner) + handler.recipientsSum() + relayerBal, OWNER_BAL);
        assertEq(handler.recipientsSum(), handler.totalPaid());
        assertEq(relayerBal, handler.totalFees());
        assertEq(usdc.balanceOf(owner), OWNER_BAL - handler.totalPaid() - handler.totalFees());
        assertEq(usdc.balanceOf(address(dp)), 0);
    }

    /// The relayer never receives a fee above maxFee, nor more than dailyLimit in fees per window.
    function invariant_RelayerFeesBounded() public view {
        assertFalse(handler.feeBoundBroken());
        assertLe(handler.feesInWindow(), handler.wSpent());
        assertLe(handler.feesInWindow(), handler.daily());
    }
}
