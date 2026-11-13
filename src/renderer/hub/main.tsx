import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { installHubBridge } from '@/lib/bridge'
import { CyphedHub } from './shell/CyphedHub'
import '../styles/base.css'

installHubBridge()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CyphedHub />
  </StrictMode>
)
