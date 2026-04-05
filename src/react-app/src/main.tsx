/**
 * Author: Zifan Si
 * Date: 2026-04-05
 * Purpose: Boots the React frontend with routing and shared providers.
 */
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import App from './App.tsx'
import { Provider } from './provider.tsx'
import '@/styles/globals.css'

/** Boots the React app and wires up routing plus shared providers. */
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Provider>
        <App />
      </Provider>
    </BrowserRouter>
  </React.StrictMode>
)
