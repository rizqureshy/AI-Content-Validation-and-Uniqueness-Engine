import { Route, Switch } from "wouter";
import { Layout } from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Documents from "./pages/Documents";
import Upload from "./pages/Upload";
import Analysis from "./pages/Analysis";
import Settings from "./pages/Settings";

export default function App() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/documents" component={Documents} />
        <Route path="/upload" component={Upload} />
        <Route path="/analysis" component={Analysis} />
        <Route path="/settings" component={Settings} />
        <Route>404 — page not found</Route>
      </Switch>
    </Layout>
  );
}
