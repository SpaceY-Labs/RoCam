import { Navigate, Route, Routes } from 'react-router-dom'

import ControlPage from './pages/control'

import LogsPage from '@/pages/logs'
import RecordingsPage from '@/pages/recordings'

function App() {
  return (
    <Routes>
      <Route element={<ControlPage />} path="/" />
      <Route element={<RecordingsPage />} path="/recordings" />
      <Route element={<LogsPage />} path="/logs" />
      <Route element={<Navigate replace to="/" />} path="*" />
    </Routes>
  )
}

export default App
