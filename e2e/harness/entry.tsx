import { createRoot } from "react-dom/client";
import { useState } from "react";
import { CheckoutView } from "@/components/checkout/CheckoutView";
import { StaffDashboard } from "@/components/staff/StaffDashboard";
import { ShopCartProvider, AddToCartControl } from "@/components/shop/ShopCart";
import { PaymentStep } from "@/components/checkout/PaymentStep";
import { MobileMenu } from "@/components/layout/MobileMenu";
import { AuthForm } from "@/components/auth/AuthForm";
const addresses = [{id:"address-1",label:"Home",line1:"1 Test St",line2:null,city:"San Jose",state:"CA",postalCode:"95112",isDefault:true}];
const categories = [{id:"11111111-1111-4111-8111-111111111111",name:"Fruit",slug:"fruit"}];
const product = (id:string,name:string) => ({id,name,sku:id,description:"",categoryId:categories[0].id,priceCents:300,unitWeight:100,imageUrl:null,inStock:true});
function PaymentFixture() {
  const [secret,setSecret] = useState("first-secret");
  const [error,setError] = useState("");
  const [authorized,setAuthorized] = useState(false);
  return <><button onClick={()=>setSecret("second-secret")}>Replace intent</button><p role="alert">{error}</p>
    <PaymentStep publishableKey="pk_test_fixture" clientSecret={secret} totalCents={315} finalizing={authorized}
      onCardError={setError} onAuthorized={()=>setAuthorized(true)}/></>;
}
function Fixture() {
  switch(window.location.pathname) {
    case "/checkout": return <CheckoutView initialAddresses={addresses} publishableKey="pk_test_fixture"/>;
    case "/staff": return <StaffDashboard role="MANAGER" email="fixture@example.test" categories={categories}/>;
    case "/employee": return <StaffDashboard role="EMPLOYEE" email="fixture@example.test" categories={categories}/>;
    case "/shop": return <ShopCartProvider><AddToCartControl product={product("apple","Apples")}/><AddToCartControl product={product("pear","Pears")}/></ShopCartProvider>;
    case "/payment": return <PaymentFixture/>;
    case "/login": return <AuthForm mode="login" next="/shop"/>;
    case "/register": return <AuthForm mode="register" next="/shop"/>;
    default: return <MobileMenu userEmail={null}/>;
  }
}
createRoot(document.getElementById("root")!).render(<main><Fixture/></main>);
