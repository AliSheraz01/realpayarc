// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ArcPay} from "../ArcPay.sol";
import {ArcPayTestBase} from "./ArcPay.Base.t.sol";

contract ArcPayUnitTest is ArcPayTestBase {
    // ---------------------------------------------------------------- deploy
    function test_Constructor_SetsUsdcAndConstants() public view {
        assertEq(address(pay.USDC()), address(usdc));
        assertEq(pay.MIN_COMMITMENT_AGE(), 5);
        assertEq(pay.MAX_COMMITMENT_AGE(), 1 days);
    }

    function test_RevertWhen_ConstructorZeroAddress() public {
        vm.expectRevert(ArcPay.ZeroAddress.selector);
        new ArcPay(IERC20(address(0)));
    }

    // ---------------------------------------------------------- makeCommitment
    function test_MakeCommitment_BindsNameOwnerSalt() public view {
        bytes32 base = pay.makeCommitment("alice", alice, SALT);
        assertEq(base, keccak256(abi.encode("alice", alice, SALT)));
        assertNotEq(base, pay.makeCommitment("alicf", alice, SALT));
        assertNotEq(base, pay.makeCommitment("alice", bob, SALT));
        assertNotEq(base, pay.makeCommitment("alice", alice, bytes32(uint256(1))));
    }

    // ------------------------------------------------------------------ commit
    function test_Commit_StoresTimestampAndEmits() public {
        bytes32 c = pay.makeCommitment("alice", alice, SALT);
        vm.expectEmit(true, true, false, true, address(pay));
        emit UsernameCommitted(alice, c);
        vm.prank(alice);
        pay.commit(c);
        assertEq(pay.commitTimestamp(c), uint64(block.timestamp));
    }

    function test_RevertWhen_CommitDuplicateUnexpired() public {
        bytes32 c = pay.makeCommitment("alice", alice, SALT);
        pay.commit(c);
        vm.expectRevert(abi.encodeWithSelector(ArcPay.CommitmentAlreadyExists.selector, c));
        pay.commit(c);
    }

    function test_RevertWhen_CommitDuplicateAtExactExpiryBoundary() public {
        bytes32 c = pay.makeCommitment("alice", alice, SALT);
        pay.commit(c);
        skip(1 days); // block.timestamp == ts + MAX -> still "existing"
        vm.expectRevert(abi.encodeWithSelector(ArcPay.CommitmentAlreadyExists.selector, c));
        pay.commit(c);
    }

    function test_Commit_ReplacesExpiredCommitment() public {
        bytes32 c = pay.makeCommitment("alice", alice, SALT);
        pay.commit(c);
        skip(1 days + 1);
        vm.expectEmit(true, true, false, true, address(pay));
        emit UsernameCommitted(address(this), c);
        pay.commit(c);
        assertEq(pay.commitTimestamp(c), uint64(block.timestamp));
    }

    // ---------------------------------------------------------------- register
    function test_Register_HappyPath() public {
        bytes32 c = pay.makeCommitment("alice", alice, SALT);
        vm.prank(alice);
        pay.commit(c);
        skip(5);

        vm.expectEmit(true, true, false, true, address(pay));
        emit UsernameRegistered(alice, keccak256("alice"), "alice");
        vm.prank(alice);
        pay.register("alice", SALT);

        assertEq(pay.resolve("alice"), alice);
        assertEq(pay.ownerOfHash(keccak256("alice")), alice);
        assertEq(pay.usernameOf(alice), "alice");
        assertEq(pay.commitTimestamp(c), 0, "commitment consumed");
    }

    function test_RevertWhen_RegisterWithoutCommit() public {
        bytes32 c = pay.makeCommitment("alice", alice, SALT);
        vm.expectRevert(abi.encodeWithSelector(ArcPay.CommitmentNotFound.selector, c));
        vm.prank(alice);
        pay.register("alice", SALT);
    }

    function test_RevertWhen_RegisterTooNew() public {
        bytes32 c = pay.makeCommitment("alice", alice, SALT);
        uint256 t0 = block.timestamp;
        vm.prank(alice);
        pay.commit(c);
        vm.expectRevert(abi.encodeWithSelector(ArcPay.CommitmentTooNew.selector, c, t0 + 5));
        vm.prank(alice);
        pay.register("alice", SALT);
    }

    function test_RevertWhen_RegisterOneSecondTooEarly() public {
        bytes32 c = pay.makeCommitment("alice", alice, SALT);
        uint256 t0 = block.timestamp;
        vm.prank(alice);
        pay.commit(c);
        skip(4);
        vm.expectRevert(abi.encodeWithSelector(ArcPay.CommitmentTooNew.selector, c, t0 + 5));
        vm.prank(alice);
        pay.register("alice", SALT);
    }

    function test_Register_SucceedsAtExactMinAge() public {
        bytes32 c = pay.makeCommitment("alice", alice, SALT);
        vm.prank(alice);
        pay.commit(c);
        skip(5);
        vm.prank(alice);
        pay.register("alice", SALT);
        assertEq(pay.resolve("alice"), alice);
    }

    function test_Register_SucceedsAtExactMaxAge() public {
        bytes32 c = pay.makeCommitment("alice", alice, SALT);
        vm.prank(alice);
        pay.commit(c);
        skip(1 days);
        vm.prank(alice);
        pay.register("alice", SALT);
        assertEq(pay.resolve("alice"), alice);
    }

    function test_RevertWhen_RegisterExpired() public {
        bytes32 c = pay.makeCommitment("alice", alice, SALT);
        vm.prank(alice);
        pay.commit(c);
        skip(1 days + 1);
        vm.expectRevert(abi.encodeWithSelector(ArcPay.CommitmentExpired.selector, c));
        vm.prank(alice);
        pay.register("alice", SALT);
    }

    function test_RevertWhen_RegisterWrongSender() public {
        bytes32 c = pay.makeCommitment("alice", alice, SALT);
        vm.prank(alice);
        pay.commit(c);
        skip(5);
        // bob (front-runner) tries to reveal alice's name with the same salt
        bytes32 bobsCommitment = pay.makeCommitment("alice", bob, SALT);
        vm.expectRevert(abi.encodeWithSelector(ArcPay.CommitmentNotFound.selector, bobsCommitment));
        vm.prank(bob);
        pay.register("alice", SALT);
        assertEq(pay.resolve("alice"), address(0));
    }

    function test_RevertWhen_RegisterWrongSalt() public {
        bytes32 c = pay.makeCommitment("alice", alice, SALT);
        vm.prank(alice);
        pay.commit(c);
        skip(5);
        bytes32 wrong = bytes32(uint256(42));
        bytes32 wrongC = pay.makeCommitment("alice", alice, wrong);
        vm.expectRevert(abi.encodeWithSelector(ArcPay.CommitmentNotFound.selector, wrongC));
        vm.prank(alice);
        pay.register("alice", wrong);
    }

    function test_RevertWhen_RegisterWrongName() public {
        bytes32 c = pay.makeCommitment("alice", alice, SALT);
        vm.prank(alice);
        pay.commit(c);
        skip(5);
        bytes32 wrongC = pay.makeCommitment("alicf", alice, SALT);
        vm.expectRevert(abi.encodeWithSelector(ArcPay.CommitmentNotFound.selector, wrongC));
        vm.prank(alice);
        pay.register("alicf", SALT);
    }

    function test_RevertWhen_RegisterReplay() public {
        _register(alice, "alice", SALT);
        // same reveal again: commitment was consumed
        bytes32 c = pay.makeCommitment("alice", alice, SALT);
        vm.expectRevert(abi.encodeWithSelector(ArcPay.CommitmentNotFound.selector, c));
        vm.prank(alice);
        pay.register("alice", SALT);
    }

    function test_RevertWhen_RegisterInvalidName() public {
        bytes32 c = pay.makeCommitment("Alice", alice, SALT);
        vm.prank(alice);
        pay.commit(c);
        skip(5);
        vm.expectRevert(ArcPay.InvalidName.selector);
        vm.prank(alice);
        pay.register("Alice", SALT);
        // revert rolls back the commitment deletion
        assertEq(pay.commitTimestamp(c), uint64(block.timestamp - 5));
    }

    function test_RevertWhen_RegisterAlreadyRegistered() public {
        _register(alice, "alice", SALT);
        bytes32 c = pay.makeCommitment("alice2", alice, SALT);
        vm.prank(alice);
        pay.commit(c);
        skip(5);
        vm.expectRevert(abi.encodeWithSelector(ArcPay.AlreadyRegistered.selector, alice));
        vm.prank(alice);
        pay.register("alice2", SALT);
        assertEq(pay.usernameOf(alice), "alice");
        assertEq(pay.resolve("alice2"), address(0));
    }

    function test_RevertWhen_RegisterNameTaken() public {
        _register(alice, "alice", SALT);
        bytes32 c = pay.makeCommitment("alice", bob, SALT);
        vm.prank(bob);
        pay.commit(c);
        skip(5);
        vm.expectRevert(abi.encodeWithSelector(ArcPay.NameTaken.selector, keccak256("alice")));
        vm.prank(bob);
        pay.register("alice", SALT);
        assertEq(pay.resolve("alice"), alice);
        assertEq(bytes(pay.usernameOf(bob)).length, 0);
    }

    function test_Register_AfterExpiredCommitmentRecommit() public {
        bytes32 c = pay.makeCommitment("alice", alice, SALT);
        vm.prank(alice);
        pay.commit(c);
        skip(1 days + 1);
        vm.prank(alice);
        pay.commit(c); // renew
        skip(5);
        vm.prank(alice);
        pay.register("alice", SALT);
        assertEq(pay.resolve("alice"), alice);
    }

    // ------------------------------------------------------------ views
    function test_Views_UnregisteredDefaults() public view {
        assertEq(pay.resolve("nobody"), address(0));
        assertEq(bytes(pay.usernameOf(alice)).length, 0);
        assertTrue(pay.isAvailable("nobody"));
    }

    function test_IsAvailable_FalseWhenTakenOrInvalid() public {
        _register(alice, "alice", SALT);
        assertFalse(pay.isAvailable("alice"));
        assertFalse(pay.isAvailable("ab"));
        assertFalse(pay.isAvailable("Bob"));
    }

    function test_IsValidName_Examples() public view {
        assertTrue(pay.isValidName("abc"));
        assertTrue(pay.isValidName("a_b"));
        assertTrue(pay.isValidName("1_2"));
        assertTrue(pay.isValidName("abc_"));
        assertFalse(pay.isValidName(""));
        assertFalse(pay.isValidName("ab"));
        assertFalse(pay.isValidName("_ab"));
        assertFalse(pay.isValidName("aBc"));
        assertFalse(pay.isValidName("a-b"));
        assertFalse(pay.isValidName("a b"));
        assertFalse(pay.isValidName("a.b"));
        assertFalse(pay.isValidName(unicode"abé"));
        assertTrue(pay.isValidName("abcdefghijklmnopqrstuvwxyz012345")); // 32
        assertFalse(pay.isValidName("abcdefghijklmnopqrstuvwxyz0123456")); // 33
    }

    // -------------------------------------------------------------------- pay
    function test_Pay_HappyPathAndEvent() public {
        _fund(alice, 100e6);
        vm.expectEmit(true, true, false, true, address(pay));
        emit Payment(alice, bob, 40e6, MEMO);
        vm.prank(alice);
        pay.pay(bob, 40e6, MEMO);
        assertEq(usdc.balanceOf(alice), 60e6);
        assertEq(usdc.balanceOf(bob), 40e6);
        assertEq(usdc.balanceOf(address(pay)), 0);
    }

    function test_RevertWhen_PayZeroRecipient() public {
        _fund(alice, 1e6);
        vm.expectRevert(abi.encodeWithSelector(ArcPay.InvalidRecipient.selector, address(0)));
        vm.prank(alice);
        pay.pay(address(0), 1, MEMO);
    }

    function test_RevertWhen_PayToContract() public {
        _fund(alice, 1e6);
        vm.expectRevert(abi.encodeWithSelector(ArcPay.InvalidRecipient.selector, address(pay)));
        vm.prank(alice);
        pay.pay(address(pay), 1, MEMO);
    }

    function test_RevertWhen_PayToSelf() public {
        _fund(alice, 1e6);
        vm.expectRevert(abi.encodeWithSelector(ArcPay.InvalidRecipient.selector, alice));
        vm.prank(alice);
        pay.pay(alice, 1, MEMO);
    }

    function test_RevertWhen_PayZeroAmount() public {
        _fund(alice, 1e6);
        vm.expectRevert(ArcPay.ZeroAmount.selector);
        vm.prank(alice);
        pay.pay(bob, 0, MEMO);
    }

    function test_Pay_InvalidRecipientCheckedBeforeZeroAmount() public {
        vm.expectRevert(abi.encodeWithSelector(ArcPay.InvalidRecipient.selector, address(0)));
        pay.pay(address(0), 0, MEMO);
    }

    function test_RevertWhen_PayWithoutAllowance() public {
        usdc.mint(alice, 10e6);
        vm.recordLogs();
        vm.expectRevert(bytes("allowance"));
        vm.prank(alice);
        pay.pay(bob, 1e6, MEMO);
        assertEq(usdc.balanceOf(bob), 0);
    }

    function test_RevertWhen_PayInsufficientBalance() public {
        _fund(alice, 1e6);
        vm.expectRevert(bytes("balance"));
        vm.prank(alice);
        pay.pay(bob, 2e6, MEMO);
    }

    // ---------------------------------------------------------- payToUsername
    function test_PayToUsername_HappyPathAndEvent() public {
        _register(bob, "bob_the_builder", SALT);
        _fund(alice, 100e6);
        vm.expectEmit(true, true, false, true, address(pay));
        emit Payment(alice, bob, 25e6, MEMO);
        vm.prank(alice);
        pay.payToUsername("bob_the_builder", 25e6, MEMO);
        assertEq(usdc.balanceOf(alice), 75e6);
        assertEq(usdc.balanceOf(bob), 25e6);
        assertEq(usdc.balanceOf(address(pay)), 0);
    }

    function test_RevertWhen_PayToUnregisteredUsername() public {
        _fund(alice, 1e6);
        vm.expectRevert(ArcPay.UnregisteredUsername.selector);
        vm.prank(alice);
        pay.payToUsername("ghost", 1, MEMO);
    }

    function test_RevertWhen_PayToOwnUsername() public {
        _register(alice, "alice", SALT);
        _fund(alice, 1e6);
        vm.expectRevert(abi.encodeWithSelector(ArcPay.InvalidRecipient.selector, alice));
        vm.prank(alice);
        pay.payToUsername("alice", 1, MEMO);
    }

    function test_RevertWhen_PayToUsernameZeroAmount() public {
        _register(bob, "bobby", SALT);
        _fund(alice, 1e6);
        vm.expectRevert(ArcPay.ZeroAmount.selector);
        vm.prank(alice);
        pay.payToUsername("bobby", 0, MEMO);
    }

    function test_PayToUsername_ExactCaseOnly() public {
        _register(bob, "bobby", SALT);
        _fund(alice, 1e6);
        vm.expectRevert(ArcPay.UnregisteredUsername.selector);
        vm.prank(alice);
        pay.payToUsername("Bobby", 1, MEMO);
    }
}
