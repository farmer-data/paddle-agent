"use client";

import { ChatSheet } from "./components/chat-sheet";

// Temporary: the full home screen replaces this page.
export default function Home() {
  return (
    <main>
      <ChatSheet open onClose={() => {}} zoneId="lower-hudson" mode="beginner" trips={[]} onTrip={() => {}} onRoute={() => {}} />
    </main>
  );
}
