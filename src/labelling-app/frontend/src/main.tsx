/**
 * Author: Jianqing Liu
 * Date: 2026-01-27
 * Purpose: Application entry point that mounts the root React component.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
