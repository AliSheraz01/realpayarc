// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ArcPayDelegate} from "../ArcPayDelegate.sol";
import {ArcPayDelegateTestBase} from "./ArcPayDelegate.Base.t.sol";

/// Constructor, setDelegation, revokeDelegation, getDelegation.
contract ArcPayDelegateConfigTest is ArcPayDelegateTestBase {
    // ---------------- constructor ----------------

    function test_Constructor_StoresUsdcAndConstants() public view {
        assertEq(address(dp.USDC()), address(usdc));
        assertEq(dp.MAX_DELEGATION_DURATION(), 90 days);
        assertEq(dp.WINDOW(), 1 days);
    }

    function test_Constructor_ZeroTokenReverts() public {
        vm.expectRevert(ArcPayDelegate.ZeroAddress.selector);
        new ArcPayDelegate(IERC20(address(0)));
    }

    // ---------------- setDelegation ----------------

    function test_SetDelegation_StoresTermsAndEmits() public {
        uint64 exp = uint64(T0 + 7 days);
        vm.expectEmit(true, true, false, true, address(dp));
        emit DelegationSet(owner, relayer, PER, DAILY, exp, MAXFEE);
        _setFull(PER, DAILY, exp, MAXFEE);

        (address r, uint128 p, uint128 d, uint64 e, uint128 mf, uint256 rem) = dp.getDelegation(owner);
        assertEq(mf, MAXFEE);
        assertEq(r, relayer);
        assertEq(p, PER);
        assertEq(d, DAILY);
        assertEq(e, exp);
        assertEq(rem, DAILY);
    }

    function test_SetDelegation_ZeroRelayerReverts() public {
        vm.prank(owner);
        vm.expectRevert(ArcPayDelegate.ZeroAddress.selector);
        dp.setDelegation(address(0), PER, DAILY, uint64(T0 + 1 days), 0);
    }

    function test_SetDelegation_SelfRelayerReverts() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ArcPayDelegate.InvalidRecipient.selector, owner));
        dp.setDelegation(owner, PER, DAILY, uint64(T0 + 1 days), 0);
    }

    function test_SetDelegation_ZeroPerPaymentReverts() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ArcPayDelegate.InvalidLimits.selector, uint128(0), DAILY));
        dp.setDelegation(relayer, 0, DAILY, uint64(T0 + 1 days), 0);
    }

    function test_SetDelegation_DailyBelowPerPaymentReverts() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ArcPayDelegate.InvalidLimits.selector, PER, PER - 1));
        dp.setDelegation(relayer, PER, PER - 1, uint64(T0 + 1 days), 0);
    }

    function test_SetDelegation_DailyEqualsPerPaymentOk() public {
        _setWith(PER, PER, uint64(T0 + 1 days));
        (, uint128 p, uint128 d,,,) = dp.getDelegation(owner);
        assertEq(p, PER);
        assertEq(d, PER);
    }

    function test_SetDelegation_ExpiryEqualNowReverts() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ArcPayDelegate.InvalidExpiry.selector, uint64(T0), T0));
        dp.setDelegation(relayer, PER, DAILY, uint64(T0), 0);
    }

    function test_SetDelegation_ExpiryInPastReverts() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ArcPayDelegate.InvalidExpiry.selector, uint64(T0 - 1), T0));
        dp.setDelegation(relayer, PER, DAILY, uint64(T0 - 1), 0);
    }

    function test_SetDelegation_ExpiryZeroReverts() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ArcPayDelegate.InvalidExpiry.selector, uint64(0), T0));
        dp.setDelegation(relayer, PER, DAILY, 0, 0);
    }

    function test_SetDelegation_ExpiryOneSecondAheadOk() public {
        _setWith(PER, DAILY, uint64(T0 + 1));
        (,,, uint64 e,,) = dp.getDelegation(owner);
        assertEq(e, T0 + 1);
    }

    function test_SetDelegation_ExpiryExactlyMaxDurationOk() public {
        uint64 exp = uint64(T0 + dp.MAX_DELEGATION_DURATION());
        _setWith(PER, DAILY, exp);
        (,,, uint64 e,,) = dp.getDelegation(owner);
        assertEq(e, exp);
    }

    function test_SetDelegation_ExpiryOneOverMaxDurationReverts() public {
        uint64 exp = uint64(T0 + dp.MAX_DELEGATION_DURATION() + 1);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ArcPayDelegate.InvalidExpiry.selector, exp, T0));
        dp.setDelegation(relayer, PER, DAILY, exp, 0);
    }

    function test_SetDelegation_ExpiryHugeReverts() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ArcPayDelegate.InvalidExpiry.selector, type(uint64).max, T0));
        dp.setDelegation(relayer, PER, DAILY, type(uint64).max, 0);
    }

    function test_SetDelegation_MaxDurationBoundTracksNow() public {
        vm.warp(T0 + 5 days);
        _setWith(PER, DAILY, uint64(T0 + 5 days + 90 days));
        vm.prank(owner);
        vm.expectRevert();
        dp.setDelegation(relayer, PER, DAILY, uint64(T0 + 5 days + 90 days + 1), 0);
    }

    function test_SetDelegation_Overwrite_ReplacesTermsAndRelayer() public {
        _set();
        vm.prank(owner);
        dp.setDelegation(other, 5e6, 10e6, uint64(T0 + 2 days), 1e6);
        (address r, uint128 p, uint128 d, uint64 e, uint128 mf,) = dp.getDelegation(owner);
        assertEq(mf, 1e6, "maxFee replaced");
        assertEq(r, other);
        assertEq(p, 5e6);
        assertEq(d, 10e6);
        assertEq(e, T0 + 2 days);

        // old relayer no longer authorized
        vm.prank(relayer);
        vm.expectRevert(ArcPayDelegate.NotAuthorized.selector);
        dp.payFor(owner, recipient, 1, 0, MEMO);
    }

    function test_SetDelegation_Overwrite_ResetsWindowAndSpent() public {
        _set();
        _pay(PER);
        _pay(PER);
        assertEq(_remaining(), DAILY - 2 * PER);

        _set(); // re-set within the same, already-spent window
        assertEq(_remaining(), DAILY);

        // full allowance is spendable again
        _pay(PER);
        _pay(PER);
        _pay(DAILY - 2 * PER);
        assertEq(_remaining(), 0);
    }

    function test_SetDelegation_Overwrite_AfterExpiryReactivates() public {
        _setWith(PER, DAILY, uint64(T0 + 1 days));
        vm.warp(T0 + 1 days + 1);
        assertEq(_remaining(), 0);
        _set();
        assertEq(_remaining(), DAILY);
        _pay(1);
    }

    function test_SetDelegation_FailedOverwriteKeepsExistingDelegation() public {
        _set();
        _pay(10e6);
        vm.prank(owner);
        vm.expectRevert(ArcPayDelegate.ZeroAddress.selector);
        dp.setDelegation(address(0), PER, DAILY, uint64(T0 + 1 days), 0);
        assertEq(_remaining(), DAILY - 10e6);
    }

    function test_SetDelegation_DoesNotTouchAllowance() public {
        uint256 a = usdc.allowance(owner, address(dp));
        _set();
        assertEq(usdc.allowance(owner, address(dp)), a);
    }

    // ---------------- maxFee / InvalidFee ----------------

    function test_SetDelegation_MaxFeeZeroAllowed() public {
        _setFull(PER, DAILY, uint64(T0 + 1 days), 0);
        (,,,, uint128 mf,) = dp.getDelegation(owner);
        assertEq(mf, 0);
    }

    function test_SetDelegation_MaxFeeEqualPerPaymentOk() public {
        _setFull(PER, DAILY, uint64(T0 + 1 days), PER);
        (,,,, uint128 mf,) = dp.getDelegation(owner);
        assertEq(mf, PER);
    }

    function test_SetDelegation_MaxFeeAbovePerPaymentReverts() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ArcPayDelegate.InvalidFee.selector, PER + 1, PER));
        dp.setDelegation(relayer, PER, DAILY, uint64(T0 + 1 days), PER + 1);
    }

    function test_SetDelegation_MaxFeeMaxUintReverts() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ArcPayDelegate.InvalidFee.selector, type(uint128).max, PER));
        dp.setDelegation(relayer, PER, DAILY, uint64(T0 + 1 days), type(uint128).max);
    }

    function test_SetDelegation_InvalidLimitsCheckedBeforeInvalidFee() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ArcPayDelegate.InvalidLimits.selector, PER, PER - 1));
        dp.setDelegation(relayer, PER, PER - 1, uint64(T0 + 1 days), PER + 1);
    }

    function test_SetDelegation_InvalidFeeCheckedBeforeInvalidExpiry() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ArcPayDelegate.InvalidFee.selector, PER + 1, PER));
        dp.setDelegation(relayer, PER, DAILY, uint64(T0), PER + 1);
    }

    function test_SetDelegation_FailedInvalidFeeKeepsExistingDelegation() public {
        _set();
        _payFee(10e6, 1e6);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ArcPayDelegate.InvalidFee.selector, PER + 1, PER));
        dp.setDelegation(relayer, PER, DAILY, uint64(T0 + 1 days), PER + 1);
        assertEq(_remaining(), DAILY - 11e6);
        (,,,, uint128 mf,) = dp.getDelegation(owner);
        assertEq(mf, MAXFEE);
    }

    function test_SetDelegation_NewMaxFeeAppliesToPayments() public {
        _set();
        _setFull(PER, DAILY, uint64(T0 + 30 days), 0);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(ArcPayDelegate.FeeTooHigh.selector, uint256(1), uint128(0)));
        dp.payFor(owner, recipient, 1e6, 1, MEMO);
    }

    function testFuzz_SetDelegation_MaxFeeBound(uint128 per, uint128 maxFee) public {
        per = uint128(bound(per, 1, type(uint128).max));
        vm.prank(owner);
        if (maxFee > per) {
            vm.expectRevert(abi.encodeWithSelector(ArcPayDelegate.InvalidFee.selector, maxFee, per));
            dp.setDelegation(relayer, per, per, uint64(T0 + 1 days), maxFee);
        } else {
            dp.setDelegation(relayer, per, per, uint64(T0 + 1 days), maxFee);
            (,,,, uint128 mf,) = dp.getDelegation(owner);
            assertEq(mf, maxFee);
        }
    }

    // ---------------- revokeDelegation ----------------

    function test_Revoke_DeletesAndEmits() public {
        _set();
        vm.expectEmit(true, true, false, false, address(dp));
        emit DelegationRevoked(owner, relayer);
        vm.prank(owner);
        dp.revokeDelegation();

        (address r, uint128 p, uint128 d, uint64 e, uint128 mf, uint256 rem) = dp.getDelegation(owner);
        assertEq(mf, 0);
        assertEq(r, address(0));
        assertEq(p, 0);
        assertEq(d, 0);
        assertEq(e, 0);
        assertEq(rem, 0);
    }

    function test_Revoke_WithoutDelegationReverts() public {
        vm.prank(owner);
        vm.expectRevert(ArcPayDelegate.NoDelegation.selector);
        dp.revokeDelegation();
    }

    function test_Revoke_Twice_SecondReverts() public {
        _set();
        vm.startPrank(owner);
        dp.revokeDelegation();
        vm.expectRevert(ArcPayDelegate.NoDelegation.selector);
        dp.revokeDelegation();
        vm.stopPrank();
    }

    function test_Revoke_WorksWhenExpired() public {
        _setWith(PER, DAILY, uint64(T0 + 1 days));
        vm.warp(T0 + 2 days);
        vm.prank(owner);
        dp.revokeDelegation();
        (address r,,,,,) = dp.getDelegation(owner);
        assertEq(r, address(0));
    }

    function test_Revoke_OnlyAffectsCaller() public {
        _set();
        vm.prank(other);
        vm.expectRevert(ArcPayDelegate.NoDelegation.selector);
        dp.revokeDelegation();
        (address r,,,,,) = dp.getDelegation(owner);
        assertEq(r, relayer);
    }

    function test_Revoke_DoesNotChangeAllowance() public {
        _set();
        uint256 a = usdc.allowance(owner, address(dp));
        vm.prank(owner);
        dp.revokeDelegation();
        assertEq(usdc.allowance(owner, address(dp)), a);
    }

    function test_Revoke_ThenSetResetsAccounting() public {
        _set();
        _pay(PER);
        vm.prank(owner);
        dp.revokeDelegation();
        _set();
        assertEq(_remaining(), DAILY);
    }

    // ---------------- getDelegation ----------------

    function test_Get_UnknownOwnerReturnsZeros() public view {
        (address r, uint128 p, uint128 d, uint64 e, uint128 mf, uint256 rem) = dp.getDelegation(other);
        assertEq(mf, 0);
        assertEq(r, address(0));
        assertEq(p, 0);
        assertEq(d, 0);
        assertEq(e, 0);
        assertEq(rem, 0);
    }

    function test_Get_FreshDelegationRemainingIsDailyLimit() public {
        _set();
        assertEq(_remaining(), DAILY);
    }

    function test_Get_RemainingDecreasesWithSpend() public {
        _set();
        _pay(30e6);
        assertEq(_remaining(), DAILY - 30e6);
        _pay(70e6);
        assertEq(_remaining(), DAILY - 100e6);
    }

    function test_Get_ElapsedWindowAtExactExpiryIsFresh() public {
        _set();
        _pay(40e6);
        vm.warp(T0 + 30 days);
        assertEq(_remaining(), DAILY, "window elapsed by then so fresh");
    }

    function test_Get_RemainingAtExpiryWithinWindow() public {
        _setWith(PER, DAILY, uint64(T0 + 1 days));
        vm.warp(T0 + 1 days - 100);
        _pay(40e6);
        vm.warp(T0 + 1 days); // inclusive expiry, same window
        assertEq(_remaining(), DAILY - 40e6);
    }

    function test_Get_ExpiredZeroRemainingButTermsKept() public {
        _setFull(PER, DAILY, uint64(T0 + 1 days), MAXFEE);
        vm.warp(T0 + 1 days + 1);
        (address r, uint128 p, uint128 d, uint64 e, uint128 mf, uint256 rem) = dp.getDelegation(owner);
        assertEq(mf, MAXFEE, "terms incl. maxFee kept after expiry");
        assertEq(r, relayer);
        assertEq(p, PER);
        assertEq(d, DAILY);
        assertEq(e, T0 + 1 days);
        assertEq(rem, 0);
    }

    function test_Get_RolledOverWindowShowsFullLimit() public {
        _set();
        _pay(PER);
        _pay(PER);
        vm.warp(T0 + 1 days - 1);
        assertEq(_remaining(), DAILY - 2 * PER, "still same window");
        vm.warp(T0 + 1 days);
        assertEq(_remaining(), DAILY, "elapsed window is fresh");
    }

    function test_Get_IsViewOnly_DoesNotRollWindow() public {
        _set();
        _pay(PER);
        vm.warp(T0 + 2 days);
        assertEq(_remaining(), DAILY);
        // time travel back: stored accounting must be unchanged (view never mutated it)
        vm.warp(T0 + 1);
        assertEq(_remaining(), DAILY - PER);
    }
}
