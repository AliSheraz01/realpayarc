// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ArcPay} from "../ArcPay.sol";
import {ArcPayTestBase} from "./ArcPay.Base.t.sol";

contract ArcPayFuzzTest is ArcPayTestBase {
    bytes internal constant ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789_";

    /// @dev Independent reference oracle for the naming rules.
    function _oracle(bytes memory v) internal pure returns (bool) {
        if (v.length < 3 || v.length > 32) return false;
        for (uint256 i; i < v.length; ++i) {
            uint8 c = uint8(v[i]);
            bool alnum = (c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39);
            if (i == 0) {
                if (!alnum) return false;
            } else if (!alnum && c != 0x5f) {
                return false;
            }
        }
        return true;
    }

    function _validName(uint256 seed, uint256 len) internal pure returns (string memory) {
        len = bound(len, 3, 32);
        bytes memory out = new bytes(len);
        for (uint256 i; i < len; ++i) {
            uint256 r = uint256(keccak256(abi.encode(seed, i)));
            // first char excludes '_' (last alphabet index)
            out[i] = ALPHABET[r % (i == 0 ? ALPHABET.length - 1 : ALPHABET.length)];
        }
        return string(out);
    }

    // ---------------------------------------------------------- name validation
    function testFuzz_IsValidName_MatchesOracle(string memory name) public view {
        assertEq(pay.isValidName(name), _oracle(bytes(name)));
    }

    function testFuzz_IsValidName_AcceptsGeneratedValidNames(uint256 seed, uint256 len) public view {
        string memory name = _validName(seed, len);
        assertTrue(pay.isValidName(name));
        assertTrue(pay.isAvailable(name));
    }

    function testFuzz_IsValidName_RejectsOneBadByte(uint256 seed, uint256 len, uint256 pos, uint8 bad) public view {
        string memory name = _validName(seed, len);
        bytes memory b = bytes(name);
        pos = bound(pos, 0, b.length - 1);
        // bad byte must be outside [a-z0-9] and, if not first, outside '_' too
        bool alnum = (bad >= 0x61 && bad <= 0x7a) || (bad >= 0x30 && bad <= 0x39);
        vm.assume(!alnum && !(pos != 0 && bad == 0x5f));
        b[pos] = bytes1(bad);
        assertFalse(pay.isValidName(string(b)));
        assertFalse(pay.isAvailable(string(b)));
    }

    function testFuzz_IsValidName_LengthBounds(uint256 len) public view {
        len = bound(len, 0, 100);
        bytes memory b = new bytes(len);
        for (uint256 i; i < len; ++i) b[i] = "a";
        assertEq(pay.isValidName(string(b)), len >= 3 && len <= 32);
    }

    function testFuzz_Register_OnlyValidNamesSucceed(string memory name, bytes32 salt) public {
        bytes32 c = pay.makeCommitment(name, alice, salt);
        vm.prank(alice);
        pay.commit(c);
        skip(5);
        vm.prank(alice);
        if (_oracle(bytes(name))) {
            pay.register(name, salt);
            assertEq(pay.resolve(name), alice);
            assertEq(pay.usernameOf(alice), name);
        } else {
            vm.expectRevert(ArcPay.InvalidName.selector);
            pay.register(name, salt);
            assertEq(pay.resolve(name), address(0));
        }
    }

    function testFuzz_Register_GeneratedNameRoundTrip(uint256 seed, uint256 len, bytes32 salt) public {
        string memory name = _validName(seed, len);
        _register(alice, name, salt);
        assertEq(pay.resolve(name), alice);
        assertEq(pay.usernameOf(alice), name);
        assertFalse(pay.isAvailable(name));
    }

    // ------------------------------------------------------------ commit timing
    function testFuzz_RegisterTiming(uint256 delay) public {
        delay = bound(delay, 0, 3 days);
        bytes32 c = pay.makeCommitment("alice", alice, SALT);
        uint256 t0 = block.timestamp;
        vm.prank(alice);
        pay.commit(c);
        skip(delay);
        vm.prank(alice);
        if (delay < 5) {
            vm.expectRevert(abi.encodeWithSelector(ArcPay.CommitmentTooNew.selector, c, t0 + 5));
            pay.register("alice", SALT);
        } else if (delay > 1 days) {
            vm.expectRevert(abi.encodeWithSelector(ArcPay.CommitmentExpired.selector, c));
            pay.register("alice", SALT);
        } else {
            pay.register("alice", SALT);
            assertEq(pay.resolve("alice"), alice);
        }
    }

    function testFuzz_CommitDuplicateTiming(uint256 delay) public {
        delay = bound(delay, 0, 3 days);
        bytes32 c = pay.makeCommitment("alice", alice, SALT);
        pay.commit(c);
        skip(delay);
        if (delay <= 1 days) {
            vm.expectRevert(abi.encodeWithSelector(ArcPay.CommitmentAlreadyExists.selector, c));
        }
        pay.commit(c);
    }

    function testFuzz_WrongSenderCannotRegister(address attacker, bytes32 salt) public {
        vm.assume(attacker != alice);
        bytes32 c = pay.makeCommitment("alice", alice, salt);
        vm.prank(alice);
        pay.commit(c);
        skip(5);
        bytes32 attackerC = pay.makeCommitment("alice", attacker, salt);
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(ArcPay.CommitmentNotFound.selector, attackerC));
        pay.register("alice", salt);
    }

    // --------------------------------------------------------------- payments
    function testFuzz_Pay_ConservesBalances(address from, address to, uint256 funded, uint256 amount, bytes32 memo)
        public
    {
        vm.assume(from != address(0) && to != address(0));
        vm.assume(from != to && to != address(pay) && from != address(pay));
        funded = bound(funded, 1, type(uint128).max);
        amount = bound(amount, 1, funded);
        _fund(from, funded);
        uint256 toBefore = usdc.balanceOf(to);
        uint256 supply = usdc.totalSupply();

        vm.expectEmit(true, true, false, true, address(pay));
        emit Payment(from, to, amount, memo);
        vm.prank(from);
        pay.pay(to, amount, memo);

        assertEq(usdc.balanceOf(from), funded - amount);
        assertEq(usdc.balanceOf(to), toBefore + amount);
        assertEq(usdc.balanceOf(address(pay)), 0);
        assertEq(usdc.totalSupply(), supply);
    }

    function testFuzz_Pay_RevertsOverBalance(uint256 funded, uint256 extra) public {
        funded = bound(funded, 0, type(uint128).max);
        extra = bound(extra, 1, type(uint128).max);
        _fund(alice, funded);
        vm.prank(alice);
        vm.expectRevert(bytes("balance"));
        pay.pay(bob, funded + extra, MEMO);
        assertEq(usdc.balanceOf(address(pay)), 0);
    }

    function testFuzz_PayToUsername_ConservesBalances(
        uint256 seed,
        uint256 len,
        uint256 funded,
        uint256 amount,
        bytes32 memo
    ) public {
        string memory name = _validName(seed, len);
        _register(bob, name, SALT);
        funded = bound(funded, 1, type(uint128).max);
        amount = bound(amount, 1, funded);
        _fund(alice, funded);

        vm.expectEmit(true, true, false, true, address(pay));
        emit Payment(alice, bob, amount, memo);
        vm.prank(alice);
        pay.payToUsername(name, amount, memo);

        assertEq(usdc.balanceOf(alice), funded - amount);
        assertEq(usdc.balanceOf(bob), amount);
        assertEq(usdc.balanceOf(address(pay)), 0);
        assertEq(usdc.balanceOf(alice) + usdc.balanceOf(bob), funded);
    }

    function testFuzz_PayToUsername_UnregisteredAlwaysReverts(string memory name, uint256 amount) public {
        _fund(alice, 1e6);
        vm.prank(alice);
        vm.expectRevert(ArcPay.UnregisteredUsername.selector);
        pay.payToUsername(name, bound(amount, 1, 1e6), MEMO);
    }
}
