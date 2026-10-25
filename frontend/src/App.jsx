import "@/App.css";
import { HashRouter, Navigate, Routes, Route } from "react-router-dom";
import { Toaster } from "sonner";
import RedactoriumPage from "@/redactorium/RedactoriumPage";

function App() {
  const embedded = new URLSearchParams(window.location.search).get("embed") === "1";

  return (
    <div className="App" data-toolkit-embedded={embedded ? "true" : undefined}>
      <HashRouter>
        <Routes>
          <Route path="/" element={<RedactoriumPage embedded={embedded} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: "#fffdf8",
            color: "#16140f",
            border: "2px solid #16140f",
            borderRadius: "0",
            fontFamily: "Space Grotesk, sans-serif",
            boxShadow: "4px 4px 0 #16140f",
          },
        }}
      />
    </div>
  );
}

export default App;
