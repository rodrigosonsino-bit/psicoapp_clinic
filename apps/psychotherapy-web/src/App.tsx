import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Auth from './pages/Auth';
import Dashboard from './pages/Dashboard';
import Patients from './pages/Patients';
import Sessions from './pages/Sessions';
import Expenses from './pages/Expenses';
import MonthlyRecords from './pages/MonthlyRecords';
import Receipts from './pages/Receipts';
import ProfileSettings from './pages/ProfileSettings';
import Appointments from './pages/Appointments';
import ConfirmAppointment from './pages/ConfirmAppointment';
import Availability from './pages/Availability';
import BookAppointment from './pages/BookAppointment';
import SelfBookAppointment from './pages/SelfBookAppointment';
import Groups from './pages/Groups';
import Fiscal from './pages/Fiscal';
import PatientProfile from './pages/PatientProfile';
import { tokenStorage } from './services/auth';

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  return tokenStorage.isAuthenticated() ? <>{children}</> : <Navigate to="/auth" replace />;
};

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/auth" element={<Auth />} />
        <Route path="/confirm/:token" element={<ConfirmAppointment />} />
        <Route path="/book/:token" element={<BookAppointment />} />
        <Route path="/self-book/:token" element={<SelfBookAppointment />} />
        
        {/* Protected Routes inside Layout */}
        <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="patients" element={<Patients />} />
          <Route path="patients/:id" element={<PatientProfile />} />
          <Route path="appointments" element={<Appointments />} />
          <Route path="availability" element={<Availability />} />
          <Route path="sessions" element={<Sessions />} />
          <Route path="expenses" element={<Expenses />} />
          <Route path="monthly-records" element={<MonthlyRecords />} />
          <Route path="receipts" element={<Receipts />} />
          <Route path="groups" element={<Groups />} />
          <Route path="fiscal" element={<Fiscal />} />
          <Route path="profile" element={<ProfileSettings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
