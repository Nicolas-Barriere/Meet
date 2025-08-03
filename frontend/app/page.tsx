"use client";

import { useRouter } from "next/navigation";
import { v4 as uuidv4 } from "uuid";
import React, { useState } from "react";
import Header from "./components/Header";
import LoadingSpinner from "./components/LoadingSpinner";

export default function Home() {
  const router = useRouter();
  const [roomIdInput, setRoomIdInput] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);

  const handleCreate = async () => {
    setIsCreating(true);
    const newRoomId = uuidv4();
    await new Promise(resolve => setTimeout(resolve, 500));
    router.push(`/${newRoomId}`);
  };

  const handleJoin = async () => {
    if (roomIdInput.trim()) {
      setIsJoining(true);
      await new Promise(resolve => setTimeout(resolve, 300));
      router.push(`/${roomIdInput.trim()}`);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && roomIdInput.trim()) {
      handleJoin();
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          {/* Hero Section */}
          <div className="text-center mb-8 animate-fade-in">
            <div className="w-20 h-20 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-2xl mx-auto mb-6 flex items-center justify-center shadow-lg">
              <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-3">
              Bienvenue sur Meet
            </h1>
            <p className="text-lg text-gray-600 dark:text-gray-300 mb-2">
              Créez ou rejoignez une visioconférence en quelques clics
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Simple, rapide et sécurisé
            </p>
          </div>

          {/* Actions Card */}
          <div className="bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm rounded-2xl shadow-xl p-8 border border-gray-200/50 dark:border-slate-700/50 animate-fade-in">
            {/* Create Meeting Button */}
            <button 
              onClick={handleCreate}
              disabled={isCreating}
              className="w-full bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white font-semibold py-4 px-6 rounded-xl transition-all duration-300 transform hover:scale-[1.02] active:scale-[0.98] shadow-lg hover:shadow-xl disabled:opacity-70 disabled:cursor-not-allowed disabled:transform-none mb-6 flex items-center justify-center space-x-2"
            >
              {isCreating ? (
                <LoadingSpinner size="sm" color="white" text="Création en cours..." />
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  <span>Créer une nouvelle visioconférence</span>
                </>
              )}
            </button>

            {/* Divider */}
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200 dark:border-slate-600"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-4 bg-white dark:bg-slate-800 text-gray-500 dark:text-gray-400 font-medium">
                  ou
                </span>
              </div>
            </div>

            {/* Join Meeting Section */}
            <div className="space-y-4">
              <label htmlFor="roomId" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Rejoindre une visioconférence existante
              </label>
              <div className="flex space-x-3">
                <div className="flex-1">
                  <input
                    id="roomId"
                    type="text"
                    placeholder="Entrez l'ID de la visioconférence"
                    value={roomIdInput}
                    onChange={e => setRoomIdInput(e.target.value)}
                    onKeyPress={handleKeyPress}
                    className="w-full px-4 py-3 border border-gray-300 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 transition-colors duration-200"
                    disabled={isJoining}
                  />
                </div>
                <button 
                  onClick={handleJoin}
                  disabled={!roomIdInput.trim() || isJoining}
                  className="px-6 py-3 bg-indigo-500 hover:bg-indigo-600 text-white font-medium rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-lg flex items-center space-x-2"
                >
                  {isJoining ? (
                    <LoadingSpinner size="sm" color="white" text="Connexion..." />
                  ) : (
                    <>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                      </svg>
                      <span>Rejoindre</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Features */}
          <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-6 animate-fade-in">
            <div className="text-center">
              <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-lg mx-auto mb-3 flex items-center justify-center">
                <svg className="w-6 h-6 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="font-semibold text-gray-900 dark:text-white mb-1">Simple</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">Interface intuitive et facile à utiliser</p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-lg mx-auto mb-3 flex items-center justify-center">
                <svg className="w-6 h-6 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h3 className="font-semibold text-gray-900 dark:text-white mb-1">Rapide</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">Connexion instantanée sans inscription</p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/30 rounded-lg mx-auto mb-3 flex items-center justify-center">
                <svg className="w-6 h-6 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <h3 className="font-semibold text-gray-900 dark:text-white mb-1">Sécurisé</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">Communications chiffrées de bout en bout</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
