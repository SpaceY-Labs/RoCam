/**
 * Author: Zifan Si
 * Date: 2025-11-15
 * Purpose: Defines the top-level route map for the React frontend.
 */
import { Navigate, Route, Routes } from 'react-router-dom'

import ControlPage from './pages/control'

import RecordingsPage from '@/pages/recordings'

/**
 * Defines the top-level route map for the frontend application.
 *
 * @returns Route definitions for the control page, recordings page, and fallback redirect.
 */
function App() {
  return (
    <Routes>
      <Route element={<ControlPage />} path="/" />
      <Route element={<RecordingsPage />} path="/recordings" />
      <Route element={<Navigate replace to="/" />} path="*" />
    </Routes>
  )
}

export default App
