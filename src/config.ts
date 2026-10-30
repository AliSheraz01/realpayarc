/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 */

import { http, createConfig } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { arc, arcTestnet } from 'viem/chains'
import { injected } from 'wagmi/connectors'
import { requireChain } from './onchain-facts'
import { registerChain } from './tracing'

// Pre-register chain RPC URLs so trace events show correct chain names immediately
registerChain(arcTestnet.id, requireChain(arcTestnet.id).rpcUrls[0])
registerChain(arc.id, requireChain(arc.id).rpcUrls[0])

const mainnetSelected = Number(import.meta.env.VITE_CHAIN_ID) === arc.id

export const config = createConfig({
  // The selected network goes first so it is the default; mainnet (Ethereum) is only for ENS.
  chains: mainnetSelected ? [arc, arcTestnet, mainnet] : [arcTestnet, arc, mainnet],
  connectors: [injected()],
  transports: {
    [arcTestnet.id]: http(requireChain(arcTestnet.id).rpcUrls[0]),
    [arc.id]: http(requireChain(arc.id).rpcUrls[0]),
    [mainnet.id]: http(),
  },
})
