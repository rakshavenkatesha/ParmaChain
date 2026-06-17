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

// Pages
import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import CreateBatch from "./pages/CreateBatch";
import TransferBatch from "./pages/TransferBatch";
import VerifyProduct from "./pages/VerifyProduct";
import AdminDashboard from "./pages/AdminDashboard";

const Layout = ({ children }) => {
  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-950 text-slate-100">
      <Navbar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-6 bg-slate-950">
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
