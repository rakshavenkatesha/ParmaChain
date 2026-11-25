import React from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate
} from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { Web3Provider } from "./context/Web3Context";
import ProtectedRoute from "./components/ProtectedRoute";
import Navbar from "./components/Navbar";
import Sidebar from "./components/Sidebar";
import NetworkGuard from "./components/NetworkGuard";

// Pages
import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import CreateBatch from "./pages/CreateBatch";
import TransferBatch from "./pages/TransferBatch";
import VerifyProduct from "./pages/VerifyProduct";
import AdminDashboard from "./pages/AdminDashboard";
import UnitLabels from "./pages/UnitLabels";
import Explorer from "./pages/Explorer";
import BatchDetail from "./pages/BatchDetail";
import GovernancePage from "./pages/GovernancePage";
import ReturnsPage from "./pages/ReturnsPage";

const Layout = ({ children }) => {
  return (
    <div className="flex flex-col h-screen overflow-hidden text-slate-100">
      <Navbar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-6">
          <NetworkGuard />
          {children}
        </main>
      </div>
    </div>
  );
};

const App = () => {
  return (
    <AuthProvider>
      <Web3Provider>
        <Router>
          <Routes>
            {/* Public Portals */}
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/verify" element={<VerifyProduct />} />
            <Route path="/explorer" element={<Explorer />} />

            {/* General Protected Routes */}
            <Route element={<ProtectedRoute />}>
              <Route
                path="/dashboard"
                element={
                  <Layout>
                    <Dashboard />
                  </Layout>
                }
              />
              <Route
                path="/batch/:batchId"
                element={
                  <Layout>
                    <BatchDetail />
                  </Layout>
                }
              />
              <Route
                path="/batches/transfer/:batchId"
                element={
                  <Layout>
                    <TransferBatch />
                  </Layout>
                }
              />
              {/* Dummy route to satisfy sidebar lists */}
              <Route
                path="/batches"
                element={
                  <Layout>
                    <Dashboard />
                  </Layout>
                }
              />
            </Route>

            {/* Manufacturer specific endpoints */}
            <Route element={<ProtectedRoute allowedRoles={["Manufacturer"]} />}>
              <Route
                path="/batches/new"
                element={
                  <Layout>
                    <CreateBatch />
                  </Layout>
                }
              />
              <Route
                path="/batches/:batchId/labels"
                element={
                  <Layout>
                    <UnitLabels />
                  </Layout>
                }
              />
            </Route>

            {/* Admin specific console routes */}
            <Route element={<ProtectedRoute allowedRoles={["Admin"]} />}>
              <Route
                path="/admin/approvals"
                element={
                  <Layout>
                    <AdminDashboard />
                  </Layout>
                }
              />
              <Route
                path="/admin/governance"
                element={
                  <Layout>
                    <GovernancePage />
                  </Layout>
                }
              />
              <Route
                path="/admin/returns"
                element={
                  <Layout>
                    <ReturnsPage />
                  </Layout>
                }
              />
              <Route
                path="/admin/anomalies"
                element={
                  <Layout>
                    <AdminDashboard />
                  </Layout>
                }
              />
            </Route>

            {/* Navigation Fallback */}
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </Router>
      </Web3Provider>
    </AuthProvider>
  );
};

export default App;
