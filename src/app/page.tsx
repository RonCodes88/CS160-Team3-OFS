import {
  Apple,
  Bot,
  Boxes,
  Carrot,
  CreditCard,
  Leaf,
  Navigation,
  Route,
  ShoppingBasket,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CornerMarks, SketchArrow, Squiggle } from "@/components/ui/Doodles";
import { IconCircle } from "@/components/ui/IconCircle";
import { StickyTag } from "@/components/ui/StickyTag";

// Marketing copy only. Real fees, limits, and totals are computed server-side.
const stats = [
  { value: "1", label: "local store", tilt: "-rotate-2" },
  { value: "10", label: "orders per robot trip", tilt: "rotate-1" },
  { value: "200 lb", label: "max per order", tilt: "-rotate-1" },
  { value: "$0", label: "delivery under 20 lb", tilt: "rotate-2" },
];

const steps = [
  { icon: ShoppingBasket, title: "Fill your cart", body: "Browse the aisles from your couch. Live prices, live stock." },
  { icon: CreditCard, title: "Check out", body: "Pay securely with Stripe. We never see your card number." },
  { icon: Route, title: "Robot batches", body: "Your order joins nearby neighbors on the next robot trip." },
  { icon: Navigation, title: "Track it live", body: "Watch the robot roll up your street on the map." },
];

const features = [
  {
    icon: Carrot,
    title: "Fresh & local",
    body: "Everything comes from one store in Downtown San Jose, so it's close and it's fresh.",
    tilt: "-rotate-1 hover:rotate-1",
  },
  {
    icon: Bot,
    title: "Robot delivery",
    body: "A self-driving robot handles the last mile. No tip screen, no small talk.",
    tilt: "rotate-1 hover:-rotate-1",
  },
  {
    icon: Boxes,
    title: "Real stock, no surprises",
    body: "If it's in your cart, it's on the shelf. Stock is checked again right before you pay.",
    tilt: "-rotate-2 hover:rotate-1",
  },
];

export default function Home() {
  return (
    <>
      {/* Hero */}
      <section className="mx-auto grid w-full max-w-5xl items-center gap-16 px-6 py-20 md:grid-cols-2">
        <div>
          <StickyTag>Now rolling in Downtown San Jose</StickyTag>
          <h1 className="mt-6 text-5xl leading-tight md:text-6xl">
            Groceries, delivered by{" "}
            <span className="relative whitespace-nowrap">
              robot
              <span
                aria-hidden
                className="absolute -bottom-1 left-0 h-3 w-full -rotate-1 rounded-wobbly bg-marker/30"
              />
            </span>
            <span className="inline-block rotate-12 text-marker">!</span>
          </h1>
          <p className="mt-6 text-xl md:text-2xl">
            Fill your cart with fresh groceries from our neighborhood store and a
            self-driving robot brings them straight to your door.
          </p>
          <div className="relative mt-10 flex flex-wrap gap-6">
            <SketchArrow className="absolute -top-14 left-44 h-16 w-24 -scale-x-100 text-pen" />
            <Button href="/shop" className="md:text-2xl">
              Start shopping
            </Button>
            <Button href="/track" variant="secondary" className="md:text-2xl">
              Track an order
            </Button>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-sm">
          <span
            aria-hidden
            className="absolute -right-6 -top-8 hidden h-16 w-16 animate-bounce-slow rounded-blob border-[3px] border-dashed border-marker md:block"
          />
          <div className="relative rotate-2 rounded-wobbly-md border-[3px] border-pencil bg-white p-10 shadow-hard-lg">
            <CornerMarks />
            <div className="flex flex-col items-center gap-6">
              <Bot aria-hidden strokeWidth={1.75} className="h-32 w-32 text-pencil" />
              <div className="flex gap-3">
                <IconCircle icon={Apple} className="-rotate-6 bg-postit" />
                <IconCircle icon={Carrot} className="rotate-3 bg-white" />
                <IconCircle icon={Leaf} className="-rotate-2 bg-postit" />
              </div>
              <p className="text-center text-lg">
                <span className="font-heading">Beep boop.</span> Your groceries are on the way.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section aria-label="OFS at a glance" className="mx-auto w-full max-w-5xl px-6 py-12">
        <ul className="grid grid-cols-2 gap-8 md:grid-cols-4">
          {stats.map((s) => (
            <li key={s.label} className={`flex flex-col items-center text-center ${s.tilt}`}>
              <span className="flex h-24 w-24 items-center justify-center rounded-blob border-[3px] border-pencil bg-white font-heading text-2xl shadow-hard md:h-32 md:w-32 md:text-3xl">
                {s.value}
              </span>
              <span className="mt-3 text-lg">{s.label}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="mx-auto w-full max-w-5xl scroll-mt-8 px-6 py-20">
        <div className="text-center">
          <StickyTag>How it works</StickyTag>
          <h2 className="mt-4 text-4xl md:text-5xl">Cart to curb in four steps</h2>
        </div>
        <div className="relative mt-14">
          <Squiggle className="absolute left-0 top-10 h-10 w-full text-pencil/40" />
          <ol className="relative grid gap-8 md:grid-cols-4">
            {steps.map((step, i) => (
              <li key={step.title} className="flex flex-col items-center text-center">
                <span className="relative z-10">
                  <IconCircle icon={step.icon} size="lg" className="bg-postit" />
                  <span className="absolute -right-2 -top-2 flex h-8 w-8 items-center justify-center rounded-full border-2 border-pencil bg-marker font-heading text-white">
                    {i + 1}
                  </span>
                </span>
                <h3 className="mt-4 text-2xl">{step.title}</h3>
                <p className="mt-2 text-lg">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Delivery fee explainer */}
      <section className="mx-auto w-full max-w-3xl px-6 py-20">
        <Card decoration="tack" tone="postit" className="-rotate-1">
          <h2 className="text-4xl md:text-5xl">
            The <span className="text-marker">20 lb</span> rule
          </h2>
          <ul className="mt-6 space-y-4 text-xl md:text-2xl">
            <li className="flex gap-3">
              <span aria-hidden>✓</span>
              <span>
                Orders <strong>under 20 lb</strong> ship <strong>free</strong>.
              </span>
            </li>
            <li className="flex gap-3">
              <span aria-hidden>✓</span>
              <span>
                <strong>20 lb and up</strong> is a flat <strong>$10</strong> delivery fee.
              </span>
            </li>
            <li className="flex gap-3">
              <span aria-hidden>✓</span>
              <span>
                Carts max out at <strong>200 lb</strong>, since the robot has its limits too.
              </span>
            </li>
          </ul>
          <p className="mt-8 inline-block rotate-1 rounded-wobbly border-2 border-dashed border-marker bg-white px-4 py-2 text-lg">
            <span className="font-heading text-marker">Heads up!</span> We&apos;ll warn you when
            your cart is getting close to 20 lb.
          </p>
        </Card>
      </section>

      {/* Features */}
      <section className="mx-auto w-full max-w-5xl px-6 py-20">
        <div className="text-center">
          <StickyTag>Why OFS</StickyTag>
          <h2 className="mt-4 text-4xl md:text-5xl">Small store, big robot energy</h2>
        </div>
        <div className="mt-14 grid gap-8 md:grid-cols-3">
          {features.map((f) => (
            <Card
              key={f.title}
              decoration="tape"
              className={`transition-transform duration-100 ${f.tilt}`}
            >
              <IconCircle icon={f.icon} />
              <h3 className="mt-4 text-2xl md:text-3xl">{f.title}</h3>
              <p className="mt-2 text-lg">{f.body}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-auto w-full max-w-3xl px-6 py-20">
        <div className="relative rounded-wobbly-md border-[3px] border-pencil bg-white p-8 text-center shadow-hard-lg md:p-12">
          <h2 className="text-4xl md:text-5xl">Hungry yet?</h2>
          <p className="mt-4 text-xl md:text-2xl">
            Make an account and your first robot delivery could be on its way today.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-6">
            <Button href="/register" className="md:text-2xl">
              Sign up free
            </Button>
            <Button href="/login" variant="secondary" className="md:text-2xl">
              I have an account
            </Button>
          </div>
          {/* Speech-bubble tail */}
          <span
            aria-hidden
            className="absolute -bottom-[22px] left-16 h-0 w-0 border-l-[18px] border-r-[18px] border-t-[22px] border-l-transparent border-r-transparent border-t-pencil"
          />
          <span
            aria-hidden
            className="absolute -bottom-[16px] left-[67px] h-0 w-0 border-l-[15px] border-r-[15px] border-t-[18px] border-l-transparent border-r-transparent border-t-white"
          />
        </div>
      </section>
    </>
  );
}
