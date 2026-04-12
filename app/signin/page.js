"use client";

import { useState } from "react";
import HamburgerMenu from "../components/HamburgerMenu";

export default function SelectUserPage() {
  const [selectedUser, setSelectedUser] = useState(null);

 const users = [
  {
    user_id: "de52999b-7269-43bd-b205-c42dc381df5d",  // ← Henrik's real UUID
    name: "Henrik",
    email: "henrikmose@gmail.com",
  },
  {
    user_id: "8d2c2f1a-636c-4897-bf05-88073215a3cc",  // ← Jessica's real UUID
    name: "Jessica",
    email: "jessdom88@gmail.com",
  },

];
  function handleSelectUser(user) {
    localStorage.setItem("user_id", user.user_id);
    localStorage.setItem("user_email", user.email);
    localStorage.setItem("user_name", user.name);
    setSelectedUser(user);
    setTimeout(() => {
      window.location.href = "/";
    }, 500);
  }

  return (
    <>
      <HamburgerMenu />
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Who's using the app?</h1>
            <p className="text-gray-600">Select your profile to continue</p>
          </div>
          <div className="space-y-4">
            {users.map((user) => (
              <button
                key={user.user_id}
                onClick={() => handleSelectUser(user)}
                disabled={selectedUser?.user_id === user.user_id}
                className="w-full p-6 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl hover:from-blue-600 hover:to-blue-700 transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="flex items-center justify-between">
                  <div className="text-left">
                    <div className="text-xl font-bold">{user.name}</div>
                    <div className="text-sm text-blue-100">{user.email}</div>
                  </div>
                  <div className="text-3xl">👤</div>
                </div>
              </button>
            ))}
          </div>
          {selectedUser && (
            <div className="mt-6 p-4 bg-green-50 text-green-800 rounded-lg text-center">
              ✅ Signed in as {selectedUser.name}
            </div>
          )}
          <div className="mt-8 pt-6 border-t border-gray-200">
            <a href="/" className="block w-full text-center text-gray-600 hover:text-gray-900 text-sm">
              Continue as Guest →
            </a>
          </div>
        </div>
      </div>
    </>
  );
}