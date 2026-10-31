/**
 * Deploys contracts/ArcPay.sol (username registry and payments) or contracts/ArcPayDelegate.sol
 * (bot spending limits) to Arc from YOUR wallet.
 *
 *   PRIVATE_KEY=0x... bun run deploy:testnet
 *   PRIVATE_KEY=0x... bun run deploy:mainnet -- --yes-mainnet
 *   PRIVATE_KEY=0x... bun run deploy:testnet -- --contract ArcPayDelegate
 *
 * Build first with `bun run contracts:build`. The deployer pays gas in USDC.
 * Mainnet moves real funds and is irreversible: this script requires --yes-mainnet AND a typed confirmation.
 * Nothing here ever prints the private key.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  createPublicClient,
  createWalletClient,
  encodeDeployData,
  formatEther,
  http,
  isAddress,
  parseAbi,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arc, arcTestnet } from 'viem/chains'
import { arcPayAbi } from '../src/lib/arcpay-abi'
import { getUsdc, requireChain } from '../src/onchain-facts'

const args = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

function fail(message: string): never {
  console.error(`\nDeploy aborted: ${message}\n`)
  process.exit(1)
}

const contractName = flag('--contract') ?? 'ArcPay'
if (contractName !== 'ArcPay' && contractName !== 'ArcPayDelegate') fail('--contract must be ArcPay or ArcPayDelegate')
const envKey = contractName === 'ArcPay' ? 'VITE_ARCPAY_ADDRESS' : 'VITE_DELEGATE_ADDRESS'

const network = flag('--network')
if (network !== 'testnet' && network !== 'mainnet') fail('pass --network testnet or --network mainnet')

const isMainnet = network === 'mainnet'
const viemChain = isMainnet ? arc : arcTestnet
const facts = requireChain(viemChain.id)
const usdc = getUsdc(viemChain.id)
if (!usdc) fail(`no USDC registered for chain ${viemChain.id}`)

const rpcUrl =
  (isMainnet ? process.env.ARC_MAINNET_RPC_URL : process.env.ARC_TESTNET_RPC_URL) || facts.rpcUrls[0]

const privateKey = process.env.PRIVATE_KEY
if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  fail('set PRIVATE_KEY (0x + 64 hex characters) in your shell environment. Never paste it into a file or command line.')
}

const artifactPath = fileURLToPath(new URL(`../contracts/out/${contractName}.sol/${contractName}.json`, import.meta.url))
if (!existsSync(artifactPath)) fail('artifact not found. Run `bun run contracts:build` first.')
const artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as { bytecode: { object: Hex } }

const account = privateKeyToAccount(privateKey as Hex)
const publicClient = createPublicClient({ chain: viemChain, transport: http(rpcUrl) })
const walletClient = createWalletClient({ account, chain: viemChain, transport: http(rpcUrl) })

const remoteChainId = await publicClient.getChainId()
if (remoteChainId !== viemChain.id) fail(`RPC reports chain ${remoteChainId}, expected ${viemChain.id}`)

const balance = await publicClient.getBalance({ address: account.address })
console.log(`Network:   ${facts.name} (chain ${viemChain.id})`)
console.log(`RPC:       ${rpcUrl}`)
console.log(`Deployer:  ${account.address}`)
console.log(`Gas funds: ${formatEther(balance)} USDC (native view, 18 decimals)`)
console.log(`USDC:      ${usdc.address} (constructor argument)`)
if (balance === 0n) fail('deployer has no USDC for gas')

if (isMainnet) {
  console.log(
    '\nWARNING: you are about to deploy to Arc MAINNET. Transactions involve real funds and are irreversible.\n' +
      'Make sure the contract has been independently reviewed and audited, and that every address above is correct.',
  )
  if (!args.includes('--yes-mainnet')) fail('mainnet deploys require the --yes-mainnet flag')
  const typed = prompt('Type DEPLOY TO MAINNET to continue:')
  if (typed?.replace(/^\uFEFF/, '').trim() !== 'DEPLOY TO MAINNET') fail('confirmation phrase did not match')
}

const data = encodeDeployData({
  abi: parseAbi(['constructor(address usdc_)']),
  bytecode: artifact.bytecode.object,
  args: [usdc.address as Hex],
})

console.log('\nSending deployment transaction...')
const hash = await walletClient.sendTransaction({ data, to: null })
console.log(`Tx: ${hash}`)
const receipt = await publicClient.waitForTransactionReceipt({ hash })
if (receipt.status !== 'success' || !receipt.contractAddress) fail('deployment transaction reverted')

const address = receipt.contractAddress
const onchainUsdc = await publicClient.readContract({ address, abi: arcPayAbi, functionName: 'USDC' })
if (onchainUsdc.toLowerCase() !== usdc.address.toLowerCase() || !isAddress(address)) {
  fail('deployed contract does not report the expected USDC address. Do not use it.')
}

const outDir = fileURLToPath(new URL('../contracts/deployments/', import.meta.url))
mkdirSync(outDir, { recursive: true })
writeFileSync(
  `${outDir}${contractName === 'ArcPay' ? '' : 'delegate.'}${network}.json`,
  JSON.stringify({ network, chainId: viemChain.id, address, txHash: hash, blockNumber: receipt.blockNumber.toString(), deployer: account.address }, null, 2),
)

console.log(`\n${contractName} deployed and verified on ${facts.name}.`)
console.log(`Contract: ${address}`)
console.log(`Explorer: ${facts.explorerBase}/address/${address}`)
console.log('\nAdd these to .env, then restart the backend and the web app:')
console.log(`VITE_CHAIN_ID=${viemChain.id}`)
console.log(`${envKey}=${address}`)
if (contractName === 'ArcPay') console.log(`ARCPAY_DEPLOY_BLOCK=${receipt.blockNumber}`)
else console.log('Also run `bun run relayer:create` and fund the printed address with a little USDC for gas.')
