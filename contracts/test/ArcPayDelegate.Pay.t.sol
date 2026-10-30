// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ArcPayDelegate} from "../ArcPayDelegate.sol";
import {ArcPayDelegateTestBase} from "./ArcPayDelegate.Base.t.sol";

/// payFor behaviour.
contract ArcPayDelegatePayTest is ArcPayDelegateTestBase {
    function setUp() public override {
        super.setUp();
        _set();
    }

    // ---------------- happy path ----------------

    function test_PayFor_MovesFundsDirectlyAndUpdatesRemaining() public {
        _pay(60e6);
        assertEq(usdc.balanceOf(owner), OWNER_BAL - 60e6);
        assertEq(usdc.balanceOf(recipient), 60e6);
        assertEq(usdc.balanceOf(address(dp)), 0);
        assertEq(usdc.balanceOf(relayer), 0);
        assertEq(_remaining(), DAILY - 60e6);
    }

    function test_PayFor_EmitsDelegatedPayment() public {
        vm.expectEmit(true, true, true, true, address(dp));
        emit DelegatedPayment(owner, recipient, relayer, 42e6, 0, MEMO);
        _pay(42e6);
    }

    function test_PayFor_ConsumesAllowance() public {
        vm.prank(owner);
        usdc.approve(address(dp), 500e6);
        _pay(60e6);
        assertEq(usdc.allowance(owner, address(dp)), 440e6);
    }

    function test_PayFor_MultipleRecipients() public {
        vm.startPrank(relayer);
        dp.payFor(owner, recipient, 10e6, 0, MEMO);
        dp.payFor(owner, other, 20e6, 0, bytes32(0));
        vm.stopPrank();
        assertEq(usdc.balanceOf(recipient), 10e6);
        assertEq(usdc.balanceOf(other), 20e6);
        assertEq(_remaining(), DAILY - 30e6);
    }

    function test_PayFor_OneUnitMinimum() public {
        _pay(1);
        assertEq(usdc.balanceOf(recipient), 1);
        assertEq(_remaining(), DAILY - 1);
    }

    // ---------------- authorization ----------------

    function test_PayFor_WrongCallerReverts() public {
        vm.prank(other);
        vm.expectRevert(ArcPayDelegate.NotAuthorized.selector);
        dp.payFor(owner, recipient, 1e6, 0, MEMO);
    }

    function test_PayFor_OwnerCallingForSelfReverts() public {
        vm.prank(owner);
        vm.expectRevert(ArcPayDelegate.NotAuthorized.selector);
        dp.payFor(owner, recipient, 1e6, 0, MEMO);
    }

    function test_PayFor_NonDelegatingOwnerReverts() public {
        usdc.mint(other, 100e6);
        vm.prank(other);
        usdc.approve(address(dp), type(uint256).max);
        vm.prank(relayer);
        vm.expectRevert(ArcPayDelegate.NotAuthorized.selector);
        dp.payFor(other, recipient, 1e6, 0, MEMO);
        assertEq(usdc.balanceOf(other), 100e6);
    }

    function test_PayFor_ZeroCallerNoDelegationReverts() public {
        // address(0) must never match the zero-relayer "no delegation" sentinel
        vm.prank(address(0));
        vm.expectRevert(ArcPayDelegate.NotAuthorized.selector);
        dp.payFor(other, recipient, 1e6, 0, MEMO);
    }

    function test_PayFor_AfterRevokeReverts() public {
        vm.prank(owner);
        dp.revokeDelegation();
        vm.prank(relayer);
        vm.expectRevert(ArcPayDelegate.NotAuthorized.selector);
        dp.payFor(owner, recipient, 1e6, 0, MEMO);
    }

    function test_PayFor_AuthorizationCheckedBeforeOtherValidation() public {
        vm.prank(other);
        vm.expectRevert(ArcPayDelegate.NotAuthorized.selector);
        dp.payFor(owner, address(0), 0, 0, MEMO);
    }

    // ---------------- expiry ----------------

    function test_PayFor_SucceedsExactlyAtExpiry() public {
        vm.warp(T0 + 30 days);
        _pay(1e6);
        assertEq(usdc.balanceOf(recipient), 1e6);
    }

    function test_PayFor_RevertsOneSecondAfterExpiry() public {
        vm.warp(T0 + 30 days + 1);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(ArcPayDelegate.DelegationExpired.selector, uint64(T0 + 30 days)));
        dp.payFor(owner, recipient, 1e6, 0, MEMO);
        assertEq(usdc.balanceOf(recipient), 0);
    }

    function test_PayFor_ExpiryCheckedBeforeRecipientAndAmount() public {
        vm.warp(T0 + 30 days + 1);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(ArcPayDelegate.DelegationExpired.selector, uint64(T0 + 30 days)));
        dp.payFor(owner, address(0), 0, 0, MEMO);
    }

    // ---------------- recipient / amount validation ----------------

    function test_PayFor_ZeroRecipientReverts() public {
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(ArcPayDelegate.InvalidRecipient.selector, address(0)));
        dp.payFor(owner, address(0), 1e6, 0, MEMO);
    }

    function test_PayFor_SelfContractRecipientReverts() public {
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(ArcPayDelegate.InvalidRecipient.selector, address(dp)));
        dp.payFor(owner, address(dp), 1e6, 0, MEMO);
    }

    function test_PayFor_RecipientIsFromReverts() public {
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(ArcPayDelegate.InvalidRecipient.selector, owner));
        dp.payFor(owner, owner, 1e6, 0, MEMO);
    }

    function test_PayFor_RelayerAsRecipientAllowed() public {
        // Only zero / contract / from are disallowed.
        vm.prank(relayer);
        dp.payFor(owner, relayer, 5e6, 0, MEMO);
        assertEq(usdc.balanceOf(relayer), 5e6);
    }

    function test_PayFor_ZeroAmountReverts() public {
        vm.prank(relayer);
        vm.expectRevert(ArcPayDelegate.ZeroAmount.selector);
        dp.payFor(owner, recipient, 0, 0, MEMO);
    }

    function test_PayFor_InvalidRecipientCheckedBeforeZeroAmount() public {
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(ArcPayDelegate.InvalidRecipient.selector, address(0)));
        dp.payFor(owner, address(0), 0, 0, MEMO);
    }

    // ---------------- per-payment limit ----------------

    function test_PayFor_ExactlyPerPaymentLimitSucceeds() public {
        _pay(PER);
        assertEq(usdc.balanceOf(recipient), PER);
    }

    function test_PayFor_OverPerPaymentLimitByOneReverts() public {
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(ArcPayDelegate.PerPaymentLimitExceeded.selector, uint256(PER) + 1, PER));
        dp.payFor(owner, recipient, uint256(PER) + 1, 0, MEMO);
        assertEq(usdc.balanceOf(recipient), 0);
        assertEq(_remaining(), DAILY);
    }

    function test_PayFor_HugeAmountRevertsPerPayment() public {
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(ArcPayDelegate.PerPaymentLimitExceeded.selector, type(uint256).max, PER));
        dp.payFor(owner, recipient, type(uint256).max, 0, MEMO);
    }

    // ---------------- daily limit ----------------

    function test_PayFor_SpendExactlyDailyLimitSucceeds() public {
        _pay(PER);
        _pay(PER);
        _pay(DAILY - 2 * PER);
        assertEq(usdc.balanceOf(recipient), DAILY);
        assertEq(_remaining(), 0);
    }

    function test_PayFor_OneOverDailyLimitReverts() public {
        _pay(PER);
        _pay(PER);
        _pay(DAILY - 2 * PER);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(ArcPayDelegate.DailyLimitExceeded.selector, uint256(1), uint256(0)));
        dp.payFor(owner, recipient, 1, 0, MEMO);
        assertEq(usdc.balanceOf(recipient), DAILY);
    }

    function test_PayFor_DailyLimitReportsRemaining() public {
        _pay(PER);
        _pay(PER);
        uint256 rem = DAILY - 2 * PER; // 50e6
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(ArcPayDelegate.DailyLimitExceeded.selector, rem + 1, rem));
        dp.payFor(owner, recipient, rem + 1, 0, MEMO);
        // exact remainder still works
        _pay(rem);
    }

    // ---------------- window rollover ----------------

    function test_PayFor_WindowStartsAtFirstPayment() public {
        vm.warp(T0 + 5 hours);
        _pay(PER);
        _pay(PER);
        _pay(DAILY - 2 * PER);
        // One second before 5h + 1 day: still the same window.
        vm.warp(T0 + 5 hours + 1 days - 1);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(ArcPayDelegate.DailyLimitExceeded.selector, uint256(1), uint256(0)));
        dp.payFor(owner, recipient, 1, 0, MEMO);
    }

    function test_PayFor_RolloverAtExactlyWindow() public {
        _pay(PER);
        _pay(PER);
        _pay(DAILY - 2 * PER);

        vm.warp(T0 + dp.WINDOW() - 1);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(ArcPayDelegate.DailyLimitExceeded.selector, uint256(1), uint256(0)));
        dp.payFor(owner, recipient, 1, 0, MEMO);

        vm.warp(T0 + dp.WINDOW());
        _pay(PER);
        assertEq(_remaining(), DAILY - PER);
        assertEq(usdc.balanceOf(recipient), DAILY + PER);
    }

    function test_PayFor_NewWindowStartsAtRolloverPayment() public {
        _pay(PER);
        vm.warp(T0 + 1 days + 3 hours);
        _pay(PER); // new window starts here
        _pay(PER);
        _pay(DAILY - 2 * PER);
        vm.warp(T0 + 1 days + 3 hours + 1 days - 1);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(ArcPayDelegate.DailyLimitExceeded.selector, uint256(1), uint256(0)));
        dp.payFor(owner, recipient, 1, 0, MEMO);
        vm.warp(T0 + 1 days + 3 hours + 1 days);
        _pay(1);
    }

    function test_PayFor_FailedPaymentDoesNotStartOrRollWindow() public {
        _pay(PER);
        vm.warp(T0 + 2 days);
        // fails on per-payment limit before any window mutation
        vm.prank(relayer);
        vm.expectRevert();
        dp.payFor(owner, recipient, uint256(PER) + 1, 0, MEMO);
        assertEq(_remaining(), DAILY);
    }

    // ---------------- token failures leave accounting unchanged ----------------

    function test_PayFor_AllowanceExhaustedRevertsNoAccountingChange() public {
        vm.prank(owner);
        usdc.approve(address(dp), 30e6);
        uint256 remBefore = _remaining();

        vm.prank(relayer);
        vm.expectRevert(bytes("allowance"));
        dp.payFor(owner, recipient, 31e6, 0, MEMO);

        assertEq(_remaining(), remBefore);
        assertEq(usdc.balanceOf(owner), OWNER_BAL);
        assertEq(usdc.balanceOf(recipient), 0);
        assertEq(usdc.allowance(owner, address(dp)), 30e6);

        // allowance remains usable for a fitting payment
        _pay(30e6);
        assertEq(_remaining(), DAILY - 30e6);
    }

    function test_PayFor_ZeroAllowanceReverts() public {
        vm.prank(owner);
        usdc.approve(address(dp), 0);
        vm.prank(relayer);
        vm.expectRevert(bytes("allowance"));
        dp.payFor(owner, recipient, 1, 0, MEMO);
        assertEq(_remaining(), DAILY);
    }

    function test_PayFor_InsufficientBalanceRevertsNoAccountingChange() public {
        // drain owner down to 10e6
        vm.prank(owner);
        usdc.transfer(other, OWNER_BAL - 10e6);
        uint256 remBefore = _remaining();

        vm.prank(relayer);
        vm.expectRevert(bytes("balance"));
        dp.payFor(owner, recipient, 11e6, 0, MEMO);

        assertEq(_remaining(), remBefore);
        assertEq(usdc.balanceOf(owner), 10e6);
        assertEq(usdc.balanceOf(recipient), 0);

        _pay(10e6);
        assertEq(_remaining(), DAILY - 10e6);
    }

    function test_PayFor_FailedTransferInNewWindowDoesNotConsumeWindow() public {
        _pay(PER);
        vm.warp(T0 + 1 days);
        vm.prank(owner);
        usdc.approve(address(dp), 0);
        vm.prank(relayer);
        vm.expectRevert(bytes("allowance"));
        dp.payFor(owner, recipient, 1, 0, MEMO);
        // Reverted tx rolled back the window reset; view still shows fresh window.
        assertEq(_remaining(), DAILY);
    }
}
