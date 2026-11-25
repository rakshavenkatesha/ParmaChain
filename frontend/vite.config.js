import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import os from 'os'

// RPC_TARGET: node used for gas-free read-only calls (consumer verification, explorer).
// Default = regulator validator of the Besu network / Hardhat node, both on :8545.
const RPC_TARGET = process.env.RPC_TARGET || 'http://127.0.0.1:8545'
const PORT = 3000

/**
 * The address other devices on the same Wi-Fi/LAN use to reach this machine. QR labels encode it,
 * so a phone camera opens the verify page here instead of an unreachable "localhost".
 * Override with PUBLIC_ORIGIN (e.g. a hotspot IP or a tunnel URL).
 */
function lanOrigin() {
  if (process.env.PUBLIC_ORIGIN) return process.env.PUBLIC_ORIGIN.replace(/\/$/, '')
  const virtual = /vEthernet|WSL|Hyper-V|VirtualBox|VMware|Docker|Loopback|vboxnet|br-|docker|veth|utun|tailscale/i
  const candidates = []
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (virtual.test(name)) continue
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue
      const score = /wi-?fi|wlan|wireless/i.test(name) ? 0 : /ethernet|eth|en\d/i.test(name) ? 1 : 2
      candidates.push({ score, address: a.address })
    }
  }
  candidates.sort((x, y) => x.score - y.score)
  return candidates.length ? `http://${candidates[0].address}:${PORT}` : `http://localhost:${PORT}`
}

const PUBLIC_ORIGIN = lanOrigin()
console.log(`\n  PharmaChain dApp for phones on the same network: ${PUBLIC_ORIGIN}\n`)

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_PUBLIC_ORIGIN': JSON.stringify(PUBLIC_ORIGIN)
  },
  server: {
    host: true, // listen on all interfaces so phones on the LAN can connect
    port: PORT,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
      // Same-origin JSON-RPC so the public verify page needs no wallet and no CORS
      '/rpc': {
        target: RPC_TARGET,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/rpc/, ''),
      }
    }
  }
})
