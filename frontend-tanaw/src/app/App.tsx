import { AppProviders } from "./providers/AppProviders";
import { AppRouter } from "./routers/AppRouter";

function App() {
  return (
    <AppProviders>
      <AppRouter />
    </AppProviders>
  );
}

export default App;
