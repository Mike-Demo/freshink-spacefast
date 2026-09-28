import type { ReactElement } from "react";
import { useRoute } from "./router";
import { Layout } from "./components/chrome";
import { WizardPage } from "./pages/Wizard";
import { CheckoutPage } from "./pages/Checkout";
import { PassPage } from "./pages/Pass";
import { AgentsPage } from "./pages/Agents";
import { LicensesPage } from "./pages/Licenses";
import { HealthPage, NotFoundPage } from "./pages/Health";

export function Root(): ReactElement {
  const route = useRoute();
  return (
    <Layout>
      {route?.name === "home" && <WizardPage />}
      {route?.name === "agents" && <AgentsPage />}
      {route?.name === "licenses" && <LicensesPage />}
      {route?.name === "health" && <HealthPage />}
      {route?.name === "checkout" && <CheckoutPage id={route.id} />}
      {route?.name === "pass" && <PassPage token={route.token} />}
      {route === null && <NotFoundPage />}
    </Layout>
  );
}
