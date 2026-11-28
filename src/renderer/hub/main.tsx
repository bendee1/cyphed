import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { CyphedHub } from './shell/CyphedHub'
import '../styles/base.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CyphedHub />
  </StrictMode>
)
