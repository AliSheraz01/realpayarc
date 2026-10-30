// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {stdError} from "forge-std/StdError.sol";
import {ArcPayDelegate} from "../ArcPayDelegate.sol";
import {ArcPayDelegateTestBase} from "./ArcPayDelegate.Base.t.sol";

/// Fee (gas reimbursement) behaviour of payFor.
contract ArcPayDelegateFeeTest is ArcPayDelegateTestBase {
    function setUp() public override {
        super.setUp();
        _set(); // PER 100e6, DAILY 250e6, MAXFEE 2e6
    }

    // ---------------- fee transfer / conservation ----------------

    function test_Fee_PaidToRelayerAndOwnerPaysAmountPlusFee() public {
        _payFee(60e6, 1e6);
        assertEq(usdc.balanceOf(recipient), 60e6);
        assertEq(usdc.balanceOf(relayer), 1e6);
        assertEq(usdc.balanceOf(owner), OWNER_BAL - 61e6);
        assertEq(usdc.balanceOf(address(dp)), 0);
    }

    function test_Fee_BalancesConserved() public {
        uint256 sumBefore = usdc.balanceOf(owner) + usdc.balanceOf(recipient) + usdc.balanceOf(relayer);
        _payFee(33e6, MAXFEE);
        uint256 sumAfter = usdc.balanceOf(owner) + usdc.balanceOf(recipient) + usdc.balanceOf(relayer)
            + usdc.balanceOf(address(dp));
        assertEq(sumAfter, sumBefore);
    }

    function test_Fee_ZeroFeeMakesNoFeeTransfer() public {
        // A zero-value transferFrom to the relayer would be observable via allowance consumption
        // only if it moved value; assert relayer got nothing and allowance dropped by amount only.
        vm.prank(owner);
        usdc.approve(address(dp), 50e6);
        _payFee(50e6, 0);
        assertEq(usdc.balanceOf(relayer), 0);
        assertEq(usdc.allowance(owner, address(dp)), 0);
        assertEq(usdc.balanceOf(recipient), 50e6);
    }

    function test_Fee_ZeroFeeNoTransferCall() public {
        vm.expectCall(
            address(usdc),
            abi.encodeWithSelector(usdc.transferFrom.selector, owner, relayer, uint256(0)),
            0
        );
        _payFee(10e6, 0);
    }

    function test_Fee_NonZeroFeeMakesFeeTransferCall() public {
        vm.expectCall(
            address(usdc), abi.encodeWithSelector(usdc.transferFrom.selector, owner, relayer, uint256(1e6)), 1
        );
        _payFee(10e6, 1e6);
    }

    function test_Fee_ConsumesAllowanceForAmountPlusFee() public {
        vm.prank(owner);
        usdc.approve(address(dp), 500e6);
        _payFee(60e6, 2e6);
        assertEq(usdc.allowance(owner, address(dp)), 438e6);
    }

    function test_Fee_FeePaidToCallerNotRecipient() public {
        // relayer is also the recipient: receives amount + fee.
        vm.prank(relayer);
        dp.payFor(owner, relayer, 5e6, 1e6, MEMO);
        assertEq(usdc.balanceOf(relayer), 6e6);
    }

    function test_Fee_EmitsDelegatedPaymentWithFee() public {
        vm.expectEmit(true, true, true, true, address(dp));
        emit DelegatedPayment(owner, recipient, relayer, 42e6, 1_500_000, MEMO);
        _payFee(42e6, 1_500_000);
    }

    // ---------------- FeeTooHigh ----------------

    function test_Fee_EqualMaxFeeOk() public {
        _payFee(10e6, MAXFEE);
        assertEq(usdc.balanceOf(relayer), MAXFEE);
    }

    function test_Fee_MaxFeePlusOneReverts() public {
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(ArcPayDelegate.FeeTooHigh.selector, uint256(MAXFEE) + 1, MAXFEE));
        dp.payFor(owner, recipient, 10e6, uint256(MAXFEE) + 1, MEMO);
        assertEq(usdc.balanceOf(relayer), 0);
        assertEq(usdc.balanceOf(recipient), 0);
        assertEq(_remaining(), DAILY);
    }

    function test_Fee_MaxFeeZeroRejectsAnyFee() public {
        _setFull(PER, DAILY, uint64(T0 + 30 days), 0);
        _payFee(10e6, 0);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(ArcPayDelegate.FeeTooHigh.selector, uint256(1), uint128(0)));
        dp.payFor(owner, recipient, 10e6, 1, MEMO);
    }

    function test_Fee_HugeFeeRevertsFeeTooHighNotOverflow() public {
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(ArcPayDelegate.FeeTooHigh.selector, type(uint256).max, MAXFEE));
        dp.payFor(owner, recipient, 1, type(uint256).max, MEMO);
    }

    function test_Fee_FeeCheckedAfterZeroAmountBeforePerPayment() public {
        // zero amount wins over a too-high fee
        vm.prank(relayer);
        vm.expectRevert(ArcPayDelegate.ZeroAmount.selector);
        dp.payFor(owner, recipient, 0, uint256(MAXFEE) + 1, MEMO);
        // fee too high wins over per-payment overflow
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(ArcPayDelegate.FeeTooHigh.selector, uint256(MAXFEE) + 1, MAXFEE));
        dp.payFor(owner, recipient, PER, uint256(MAXFEE) + 1, MEMO);
    }

    function test_Fee_NonRelayerCannotClaimFee() public {
        vm.prank(other);
        vm.expectRevert(ArcPayDelegate.NotAuthorized.selector);
        dp.payFor(owner, recipient, 1e6, 1e6, MEMO);
        assertEq(usdc.balanceOf(other), 0);
    }

    // ---------------- per-payment limit includes fee ----------------

    function test_Fee_AmountPlusFeeExactlyPerPaymentOk() public {
        _payFee(PER - MAXFEE, MAXFEE);
        assertEq(usdc.balanceOf(recipient), PER - MAXFEE);
        assertEq(usdc.balanceOf(relayer), MAXFEE);
        assertEq(_remaining(), DAILY - PER);
    }

    function test_Fee_AmountPlusFeePerPaymentPlusOneReverts() public {
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(ArcPayDelegate.PerPaymentLimitExceeded.selector, uint256(PER) + 1, PER));
        dp.payFor(owner, recipient, PER - MAXFEE + 1, MAXFEE, MEMO);
        assertEq(usdc.balanceOf(relayer), 0);
        assertEq(_remaining(), DAILY);
    }

    function test_Fee_FullAmountPlusAnyFeeExceedsPerPayment() public {
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(ArcPayDelegate.PerPaymentLimitExceeded.selector, uint256(PER) + 1, PER));
        dp.payFor(owner, recipient, PER, 1, MEMO);
    }

    function test_Fee_MaxFeeEqualPerPaymentAllowsFeeOnlyPlusOneAmount() public {
        _setFull(PER, DAILY, uint64(T0 + 30 days), PER);
        _payFee(1, PER - 1);
        assertEq(usdc.balanceOf(recipient), 1);
        assertEq(usdc.balanceOf(relayer), PER - 1);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(ArcPayDelegate.PerPaymentLimitExceeded.selector, uint256(PER) + 1, PER));
        dp.payFor(owner, recipient, 1, PER, MEMO);
    }

    // ---------------- daily limit includes fee ----------------

    function test_Fee_CountedInRemaining() public {
        _payFee(30e6, 2e6);
        assertEq(_remaining(), DAILY - 32e6);
        _payFee(10e6, 1e6);
        assertEq(_remaining(), DAILY - 43e6);
    }

    function test_Fee_ZeroFeeLeavesRemainingAmountOnly() public {
        _payFee(30e6, 0);
        assertEq(_remaining(), DAILY - 30e6);
    }

    function test_Fee_DailyExactlyAtLimitOk() public {
        _payFee(PER - MAXFEE, MAXFEE); // 100
        _payFee(PER - MAXFEE, MAXFEE); // 200
        _payFee(DAILY - 2 * PER - MAXFEE, MAXFEE); // 250 exactly
        assertEq(_remaining(), 0);
        assertEq(usdc.balanceOf(relayer), 3 * uint256(MAXFEE));
        assertEq(usdc.balanceOf(recipient), DAILY - 3 * uint256(MAXFEE));
    }

    function test_Fee_DailyPlusOneRevertsWithTotalAndRemaining() public {
        _pay(PER);
        _pay(PER); // remaining 50e6
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(ArcPayDelegate.DailyLimitExceeded.selector, uint256(50e6 + 1), uint256(50e6)));
        dp.payFor(owner, recipient, 50e6 - 1, 2, MEMO); // total 50e6 + 1
        assertEq(_remaining(), 50e6);
    }

    function test_Fee_OnlyFeePushesOverDailyLimit() public {
        _pay(PER);
        _pay(PER);
        _pay(50e6 - 1); // remaining 1
        // amount 1 would fit, but amount + fee(1) = 2 does not
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(ArcPayDelegate.DailyLimitExceeded.selector, uint256(2), uint256(1)));
        dp.payFor(owner, recipient, 1, 1, MEMO);
        _payFee(1, 0);
        assertEq(_remaining(), 0);
    }

    function test_Fee_RemainingResetsOnRolloverIncludingFees() public {
        _payFee(90e6, 2e6);
        _payFee(90e6, 2e6);
        assertEq(_remaining(), DAILY - 184e6);
        vm.warp(T0 + 1 days);
        assertEq(_remaining(), DAILY);
        _payFee(PER - MAXFEE, MAXFEE);
        assertEq(_remaining(), DAILY - PER);
    }

    function test_Fee_FailedPaymentWithFeeDoesNotChangeAccounting() public {
        vm.prank(owner);
        usdc.approve(address(dp), 10e6);
        vm.prank(relayer);
        vm.expectRevert(bytes("allowance"));
        dp.payFor(owner, recipient, 10e6, 1, MEMO); // amount fits, amount+fee does not
        assertEq(_remaining(), DAILY);
        assertEq(usdc.balanceOf(recipient), 0, "recipient transfer rolled back");
        assertEq(usdc.balanceOf(relayer), 0);
    }

    // ---------------- overflow ----------------

    function test_Fee_AmountPlusFeeOverflowReverts() public {
        // fee passes FeeTooHigh (<= MAXFEE); amount + fee overflows uint256 -> checked-arithmetic panic
        vm.prank(relayer);
        vm.expectRevert(stdError.arithmeticError);
        dp.payFor(owner, recipient, type(uint256).max, 1, MEMO);
        assertEq(usdc.balanceOf(recipient), 0);
        assertEq(usdc.balanceOf(relayer), 0);
        assertEq(_remaining(), DAILY);
    }

    function test_Fee_AmountMaxMinusFeeBoundaryNoWrap() public {
        // max - 1 + 1 == max: no overflow, falls to per-payment limit revert
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(ArcPayDelegate.PerPaymentLimitExceeded.selector, type(uint256).max, PER));
        dp.payFor(owner, recipient, type(uint256).max - 1, 1, MEMO);
    }

    function testFuzz_Fee_NoWrapAroundPaysNothing(uint256 amount, uint256 fee) public {
        amount = bound(amount, uint256(PER) + 1, type(uint256).max);
        fee = bound(fee, 0, MAXFEE);
        vm.prank(relayer);
        vm.expectRevert(); // overflow panic or PerPaymentLimitExceeded; never succeeds
        dp.payFor(owner, recipient, amount, fee, MEMO);
        assertEq(usdc.balanceOf(recipient), 0);
        assertEq(usdc.balanceOf(relayer), 0);
    }
}
