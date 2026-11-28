import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BarApp } from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BarApp />
  </StrictMode>
)
