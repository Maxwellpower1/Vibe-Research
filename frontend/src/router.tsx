import { createBrowserRouter, Navigate } from "react-router-dom";
import { Layout } from "@/components/layout/Layout";
import { AShare } from "@/pages/AShare";
import { Portfolio } from "@/pages/Portfolio";
import { StockDataRedirect } from "@/pages/StockDataRedirect";
import { Watchlist } from "@/pages/Watchlist";
import { Notes } from "@/pages/Notes";
import { Ovlab } from "@/pages/Ovlab";
import { UsMarket } from "@/pages/UsMarket";
import { Settings } from "@/pages/Settings";

export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: "/", element: <Navigate to="/a-share" replace /> },
      { path: "/a-share", element: <AShare /> },
      // legacy bookmarks
      { path: "/daily-review", element: <Navigate to="/a-share" replace /> },
      { path: "/sectors", element: <Navigate to="/a-share" replace /> },
      { path: "/sectors/:key", element: <Navigate to="/a-share" replace /> },
      { path: "/debate", element: <Navigate to="/a-share" replace /> },
      { path: "/intel", element: <Navigate to="/a-share" replace /> },
      { path: "/my-reports", element: <Navigate to="/a-share" replace /> },
      { path: "/portfolio", element: <Portfolio /> },
      { path: "/stock-data", element: <StockDataRedirect /> },
      { path: "/watchlist", element: <Watchlist /> },
      { path: "/ovlab", element: <Ovlab /> },
      { path: "/us-market", element: <UsMarket /> },
      { path: "/notes", element: <Notes /> },
      { path: "/settings", element: <Settings /> },
    ],
  },
]);
