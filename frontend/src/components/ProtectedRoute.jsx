import React, { useContext } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";

const ProtectedRoute = ({ allowedRoles }) => {
  const { user, loading } = useContext(AuthContext);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 text-slate-100">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-sky-500 border-t-transparent"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Check if organization has administrator authorization
  if (!user.isApproved && user.role !== "Admin") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-4 text-center text-slate-200">
        <div className="glass-panel max-w-md rounded-2xl p-8 shadow-2xl">
          <h2 className="text-2xl font-bold text-red-400 mb-4">Pending Verification</h2>
          <p className="text-slate-400 mb-6">
            Welcome, <strong>{user.name}</strong>! Your organization profile (Role: {user.role}) is registered, but requires Administrator verification before you can interact with the supply chain network.
          </p>
          <div className="p-4 bg-slate-900 rounded-xl text-sm border border-slate-800 text-slate-500 font-mono mb-6">
            Organization: {user.companyName || "N/A"} <br/>
            License: {user.licenseNumber || "N/A"}
          </div>
          <button
            onClick={() => { localStorage.removeItem("token"); window.location.reload(); }}
            className="w-full py-3 bg-red-500/10 hover:bg-red-500/20 text-red-400 font-semibold rounded-xl transition border border-red-500/20"
          >
            Logout / Switch Account
          </button>
        </div>
      </div>
    );
  }

  // If a role is restricted
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
};

export default ProtectedRoute;
