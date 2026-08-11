import { createBrowserRouter, Navigate } from "react-router-dom";
import { Layout } from "@/components/layout/Layout";
import { AShare } from "@/pages/AShare";
import { Portfolio } from "@/pages/Portfolio";
import { StockDataRedirect } from "@/pages/StockDataRedirect";
import { Ovlab } from "@/pages/Ovlab";
import { UsMarket } from "@/pages/UsMarket";
import { Settings } from "@/pages/Settings";
import { Weather } from "@/pages/Weather";

export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: "/", element: <Navigate to="/a-share" replace /> },
      { path: "/a-share", element: <AShare /> },
      { path: "/weather", element: <Weather /> },
      // legacy bookmarks
      { path: "/daily-review", element: <Navigate to="/a-share" replace /> },
      { path: "/sectors", element: <Navigate to="/a-share" replace /> },
      { path: "/sectors/:key", element: <Navigate to="/a-share" replace /> },
      { path: "/debate", element: <Navigate to="/a-share" replace /> },
      { path: "/intel", element: <Navigate to="/a-share" replace /> },
      { path: "/my-reports", element: <Navigate to="/a-share" replace /> },
      { path: "/portfolio", element: <Portfolio /> },
      { path: "/stock-data", element: <StockDataRedirect /> },
      { path: "/watchlist", element: <Navigate to="/a-share?tab=kline" replace /> },
      { path: "/ovlab", element: <Ovlab /> },
      { path: "/us-market", element: <UsMarket /> },
      { path: "/notes", element: <Navigate to="/a-share" replace /> },
      { path: "/settings", element: <Settings /> },
    ],
  },
]);
