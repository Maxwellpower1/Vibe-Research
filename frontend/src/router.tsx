import { createBrowserRouter, Navigate } from "react-router-dom";
import { Layout } from "@/components/layout/Layout";
import { AShare } from "@/pages/AShare";
import { Intel } from "@/pages/Intel";
import { Portfolio } from "@/pages/Portfolio";
import { StockData } from "@/pages/StockData";
import { Watchlist } from "@/pages/Watchlist";
import { MyReports } from "@/pages/MyReports";
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
      { path: "/intel", element: <Intel /> },
      { path: "/portfolio", element: <Portfolio /> },
      { path: "/stock-data", element: <StockData /> },
      { path: "/watchlist", element: <Watchlist /> },
      { path: "/my-reports", element: <MyReports /> },
      { path: "/ovlab", element: <Ovlab /> },
      { path: "/us-market", element: <UsMarket /> },
      { path: "/notes", element: <Notes /> },
      { path: "/settings", element: <Settings /> },
    ],
  },
]);
