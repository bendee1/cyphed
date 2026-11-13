import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { installHubBridge } from '@/lib/bridge'
import { BarApp } from './App'
import './styles.css'

installHubBridge()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BarApp />
  </StrictMode>
)
