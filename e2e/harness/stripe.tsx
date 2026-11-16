import { createContext, useContext, useState, type ReactNode } from "react";
const Secret = createContext("");
export function loadStripe() { return Promise.resolve({}); }
export function Elements({children, options}: {children:ReactNode; options:{clientSecret:string}}) {
  // Stripe Elements cannot change its clientSecret after mounting.
  const [secret] = useState(options.clientSecret);
  return <Secret.Provider value={secret}>{children}</Secret.Provider>;
}
export function PaymentElement() { return <p role="status">Card form: {useContext(Secret)}</p>; }
export function useElements() { return {}; }
export function useStripe() { return { confirmPayment: async () => {
  const response = await fetch("/fake-stripe", {method:"POST"});
  if (!response.ok) throw new Error("Stripe disconnected");
  return response.json();
} }; }
