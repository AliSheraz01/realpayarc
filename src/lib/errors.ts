import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from 'viem'

export interface FriendlyError {
  message: string
  /** True when the person simply dismissed the wallet prompt. Show nothing loud. */
  cancelled: boolean
}

const CONTRACT_ERRORS: Record<string, string> = {
  InvalidName: 'Usernames are 3 to 32 characters: lowercase letters, numbers and underscores, not starting with an underscore.',
  NameTaken: 'That username is already taken. Try another one.',
  AlreadyRegistered: 'This wallet already has a username.',
  InvalidRecipient: 'That recipient wallet is not valid (zero address, the contract itself, or your own wallet).',
  ZeroAmount: 'Enter an amount greater than zero.',
  UnregisteredUsername: 'That username is not registered.',
  CommitmentNotFound: 'No pending registration found for this wallet and name. Start the registration again.',
  CommitmentTooNew: 'Registration is not ready yet. Wait a few seconds and try again.',
  CommitmentExpired: 'The registration request expired. Start again.',
  CommitmentAlreadyExists: 'A registration for this name is already pending.',
}

/** Turn a wagmi / viem failure into one sentence a person can act on. */
export function friendlyError(error: unknown): FriendlyError {
  if (error instanceof BaseError) {
    if (error.walk((e) => e instanceof UserRejectedRequestError)) {
      return { message: 'Transaction cancelled.', cancelled: true }
    }
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError)
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName
      if (name && CONTRACT_ERRORS[name]) return { message: CONTRACT_ERRORS[name], cancelled: false }
      if (reverted.reason) return { message: `The contract rejected this: ${reverted.reason}`, cancelled: false }
    }
  }

  const text = (error instanceof Error ? error.message : String(error)).toLowerCase()
  if (/user rejected|user denied|rejected the request/.test(text)) {
    return { message: 'Transaction cancelled.', cancelled: true }
  }
  if (/insufficient funds|exceeds balance|gas required exceeds|insufficient balance/.test(text)) {
    return { message: 'Not enough USDC to cover this payment plus network fees (gas is paid in USDC on Arc).', cancelled: false }
  }
  if (/chain mismatch|wrong network|does not match the target chain/.test(text)) {
    return { message: 'Your wallet is on the wrong network. Switch to Arc and try again.', cancelled: false }
  }
  if (/network|timeout|fetch failed|failed to fetch/.test(text)) {
    return { message: 'Network issue. Check your connection and try again.', cancelled: false }
  }
  return { message: 'Something went wrong. Please try again.', cancelled: false }
}
