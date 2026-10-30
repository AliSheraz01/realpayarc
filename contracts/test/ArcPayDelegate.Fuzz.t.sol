// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ArcPayDelegate} from "../ArcPayDelegate.sol";
import {ArcPayDelegateTestBase} from "./ArcPayDelegate.Base.t.sol";

contract ArcPayDelegateFuzzTest is ArcPayDelegateTestBase {
    /// Random payment/time sequences checked against an independent window model.
    function testFuzz_WindowSpendNeverExceedsDailyLimit(
        uint128 per,
        uint128 daily,
        uint256[] memory amounts,
        uint256[] memory dts
    ) public {
        per = uint128(bound(per, 1, 1_000e6));
        daily = uint128(bound(daily, per, 5_000e6));
        _setWith(per, daily, uint64(T0 + 90 days));

        uint256 n = amounts.length < dts.length ? amounts.length : dts.length;
        if (n > 16) n = 16;

        uint256 modelStart; // 0 = unused
        uint256 modelSpent;
        uint256 paid;

        for (uint256 i = 0; i < n; i++) {
            skip(bound(dts[i], 0, 2 days));
            uint256 amt = bound(amounts[i], 0, uint256(per) + per / 2 + 1);

            bool newWindow = modelStart == 0 || block.timestamp >= modelStart + 1 days;
            uint256 spentNow = newWindow ? 0 : modelSpent;
            bool expectOk = amt > 0 && amt <= per && spentNow + amt <= daily;

            vm.prank(relayer);
            try dp.payFor(owner, recipient, amt, 0, MEMO) {
                assertTrue(expectOk, "paid but model says it should revert");
                // PROPERTY: no single payment above per-payment limit
                assertLe(amt, per);
                if (newWindow) {
                    modelStart = block.timestamp;
                    modelSpent = 0;
                }
                modelSpent += amt;
                paid += amt;
                // PROPERTY: window spend never exceeds the daily limit
                assertLe(modelSpent, daily);
                assertEq(_remaining(), uint256(daily) - modelSpent);
            } catch {
                assertFalse(expectOk, "reverted but model says it should pass");
            }
        }

        // PROPERTY: balances conserved, contract holds nothing
        assertEq(usdc.balanceOf(recipient), paid);
        assertEq(usdc.balanceOf(owner) + usdc.balanceOf(recipient), OWNER_BAL);
        assertEq(usdc.balanceOf(address(dp)), 0);
    }

    function testFuzz_SingleWindowTotalBoundedByDaily(uint128 per, uint128 daily, uint256[8] memory amounts) public {
        per = uint128(bound(per, 1, 1_000e6));
        daily = uint128(bound(daily, per, 5_000e6));
        _setWith(per, daily, uint64(T0 + 30 days));

        uint256 total;
        for (uint256 i = 0; i < 8; i++) {
            uint256 amt = bound(amounts[i], 1, per);
            vm.prank(relayer);
            try dp.payFor(owner, recipient, amt, 0, MEMO) {
                total += amt;
            } catch (bytes memory err) {
                assertEq(bytes4(err), ArcPayDelegate.DailyLimitExceeded.selector);
            }
        }
        assertLe(total, daily);
        assertEq(usdc.balanceOf(recipient), total);
        assertEq(_remaining(), uint256(daily) - total);
    }

    function testFuzz_PerPaymentLimitEnforced(uint128 per, uint256 amount) public {
        per = uint128(bound(per, 1, 1_000e6));
        _setWith(per, 5_000e6, uint64(T0 + 1 days));
        amount = bound(amount, 1, 10_000e6);

        vm.prank(relayer);
        if (amount > per) {
            vm.expectRevert(abi.encodeWithSelector(ArcPayDelegate.PerPaymentLimitExceeded.selector, amount, per));
            dp.payFor(owner, recipient, amount, 0, MEMO);
            assertEq(usdc.balanceOf(recipient), 0);
        } else {
            dp.payFor(owner, recipient, amount, 0, MEMO);
            assertEq(usdc.balanceOf(recipient), amount);
        }
        assertEq(usdc.balanceOf(owner) + usdc.balanceOf(recipient), OWNER_BAL);
    }

    struct Model {
        uint256 start;
        uint256 spent;
        uint256 feesInWindow;
        uint256 totalFees;
        uint256 totalAmounts;
        uint128 per;
        uint128 daily;
        uint128 maxFee;
    }

    /// Fee-aware model: amount+fee counts against both limits; relayer can never extract more than
    /// maxFee per payment nor more than dailyLimit in fees per window.
    function testFuzz_RelayerFeesBoundedPerWindow(
        uint128 per,
        uint128 daily,
        uint128 maxFee,
        uint256[] memory amounts,
        uint256[] memory fees,
        uint256[] memory dts
    ) public {
        Model memory m;
        m.per = uint128(bound(per, 1, 1_000e6));
        m.daily = uint128(bound(daily, m.per, 5_000e6));
        m.maxFee = uint128(bound(maxFee, 0, m.per));
        _setFull(m.per, m.daily, uint64(T0 + 90 days), m.maxFee);

        uint256 n = amounts.length < dts.length ? amounts.length : dts.length;
        if (fees.length < n) n = fees.length;
        if (n > 16) n = 16;

        for (uint256 i = 0; i < n; i++) {
            skip(bound(dts[i], 0, 2 days));
            _step(m, bound(amounts[i], 0, uint256(m.per) + 1), bound(fees[i], 0, uint256(m.maxFee) + 1));
        }

        assertEq(usdc.balanceOf(relayer), m.totalFees);
        assertEq(usdc.balanceOf(recipient), m.totalAmounts);
        assertEq(usdc.balanceOf(owner), OWNER_BAL - m.totalFees - m.totalAmounts);
        assertEq(usdc.balanceOf(address(dp)), 0);
    }

    function _step(Model memory m, uint256 amt, uint256 fee) internal {
        bool newWindow = m.start == 0 || block.timestamp >= m.start + 1 days;
        uint256 spentNow = newWindow ? 0 : m.spent;
        bool expectOk = amt > 0 && fee <= m.maxFee && amt + fee <= m.per && spentNow + amt + fee <= m.daily;

        vm.prank(relayer);
        try dp.payFor(owner, recipient, amt, fee, MEMO) {
            assertTrue(expectOk, "paid but model says it should revert");
            if (newWindow) {
                m.start = block.timestamp;
                m.spent = 0;
                m.feesInWindow = 0;
            }
            m.spent += amt + fee;
            m.feesInWindow += fee;
            m.totalFees += fee;
            m.totalAmounts += amt;
            assertLe(fee, m.maxFee, "fee above maxFee");
            assertLe(amt + fee, m.per, "payment+fee above per-payment limit");
            assertLe(m.feesInWindow, m.daily, "fees in window above dailyLimit");
            assertLe(m.spent, m.daily, "window spend above dailyLimit");
            assertEq(_remaining(), uint256(m.daily) - m.spent);
        } catch {
            assertFalse(expectOk, "reverted but model says it should pass");
        }
    }

    /// Greedy relayer always claiming maxFee: fees in one window never exceed dailyLimit.
    function testFuzz_GreedyRelayerFeesCappedInWindow(uint128 per, uint128 daily, uint128 maxFee, uint256 amount)
        public
    {
        per = uint128(bound(per, 1, 1_000e6));
        daily = uint128(bound(daily, per, 5_000e6));
        maxFee = uint128(bound(maxFee, 1, per));
        _setFull(per, daily, uint64(T0 + 30 days), maxFee);

        for (uint256 i = 0; i < 40; i++) {
            uint256 amt = bound(uint256(keccak256(abi.encode(amount, i))), 1, per);
            vm.prank(relayer);
            try dp.payFor(owner, recipient, amt, maxFee, MEMO) {} catch {}
        }
        assertLe(usdc.balanceOf(relayer), daily, "fees exceeded dailyLimit in a single window");
        assertEq(usdc.balanceOf(relayer) % maxFee, 0, "each fee equals maxFee");
        assertEq(usdc.balanceOf(relayer) + usdc.balanceOf(recipient) + usdc.balanceOf(owner), OWNER_BAL);
    }

    function testFuzz_FeeTooHighBoundary(uint128 maxFee, uint256 fee) public {
        maxFee = uint128(bound(maxFee, 0, PER - 1));
        fee = bound(fee, 0, uint256(PER));
        _setFull(PER, DAILY, uint64(T0 + 1 days), maxFee);
        vm.prank(relayer);
        if (fee > maxFee) {
            vm.expectRevert(abi.encodeWithSelector(ArcPayDelegate.FeeTooHigh.selector, fee, maxFee));
            dp.payFor(owner, recipient, 1, fee, MEMO);
            assertEq(usdc.balanceOf(relayer), 0);
        } else {
            dp.payFor(owner, recipient, 1, fee, MEMO);
            assertEq(usdc.balanceOf(relayer), fee);
            assertEq(_remaining(), uint256(DAILY) - 1 - fee);
        }
    }

    function testFuzz_SetDelegationExpiryBounds(uint64 expiry) public {
        vm.prank(owner);
        bool valid = expiry > T0 && uint256(expiry) <= T0 + 90 days;
        if (valid) {
            dp.setDelegation(relayer, PER, DAILY, expiry, 0);
            (,,, uint64 e,,) = dp.getDelegation(owner);
            assertEq(e, expiry);
        } else {
            vm.expectRevert(abi.encodeWithSelector(ArcPayDelegate.InvalidExpiry.selector, expiry, T0));
            dp.setDelegation(relayer, PER, DAILY, expiry, 0);
        }
    }

    function testFuzz_SetDelegationLimitBounds(uint128 per, uint128 daily) public {
        vm.prank(owner);
        if (per == 0 || daily < per) {
            vm.expectRevert(abi.encodeWithSelector(ArcPayDelegate.InvalidLimits.selector, per, daily));
            dp.setDelegation(relayer, per, daily, uint64(T0 + 1 days), 0);
        } else {
            dp.setDelegation(relayer, per, daily, uint64(T0 + 1 days), 0);
            assertEq(_remaining(), daily);
        }
    }

    function testFuzz_RolloverBoundary(uint256 dt) public {
        _setWith(PER, PER, uint64(T0 + 90 days));
        _pay(PER);
        dt = bound(dt, 0, 3 days);
        skip(dt);
        if (dt < 1 days) {
            vm.prank(relayer);
            vm.expectRevert(abi.encodeWithSelector(ArcPayDelegate.DailyLimitExceeded.selector, uint256(1), uint256(0)));
            dp.payFor(owner, recipient, 1, 0, MEMO);
            assertEq(_remaining(), 0);
        } else {
            _pay(PER);
            assertEq(usdc.balanceOf(recipient), 2 * uint256(PER));
        }
    }
}
