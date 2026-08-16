import { lazy } from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";
import { RouteError } from "@/components/common/RouteError";
import { Layout } from "@/components/layout/Layout";
import { StockDataRedirect } from "@/pages/StockDataRedirect";

// Heavy pages load on demand; Suspense boundary lives in Layout around <Outlet />.
const AShare = lazy(() => import("@/pages/AShare").then((m) => ({ default: m.AShare })));
const Portfolio = lazy(() => import("@/pages/Portfolio").then((m) => ({ default: m.Portfolio })));
const Ovlab = lazy(() => import("@/pages/Ovlab").then((m) => ({ default: m.Ovlab })));
const UsMarket = lazy(() => import("@/pages/UsMarket").then((m) => ({ default: m.UsMarket })));
const Settings = lazy(() => import("@/pages/Settings").then((m) => ({ default: m.Settings })));
const AiWatch = lazy(() => import("@/pages/AiWatch").then((m) => ({ default: m.AiWatch })));
const FinWindow = lazy(() => import("@/pages/FinWindow").then((m) => ({ default: m.FinWindow })));
const Research = lazy(() => import("@/pages/Research").then((m) => ({ default: m.Research })));

export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      {
        errorElement: <RouteError />,
        children: [
          { path: "/", element: <Navigate to="/a-share" replace /> },
          { path: "/a-share", element: <AShare /> },
          // legacy bookmarks
          { path: "/weather", element: <Navigate to="/a-share" replace /> },
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
          { path: "/research", element: <Research /> },
          { path: "/ai-watch", element: <AiWatch /> },
          { path: "/fin", element: <FinWindow /> },
          { path: "/notes", element: <Navigate to="/a-share" replace /> },
          { path: "/settings", element: <Settings /> },
        ],
      },
    ],
  },
]);
