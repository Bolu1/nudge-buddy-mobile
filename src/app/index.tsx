import { Redirect } from "expo-router";
import { useAuth } from "@/lib/auth-context";

export default function Index() {
  const { status } = useAuth();
  return <Redirect href={status === "signedIn" ? "/workspace" : "/signin"} />;
}
