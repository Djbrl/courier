# Quickstart

Courier lets you ask Claude to buy something and have it just happen, inside limits you set. PayPal confirms you're a
real person, and your AI gets its own ID and spending rules.

This page covers what Courier does, what works today and what's next, as of October 31, 2026.

## The story

You want a jazz record for your dad's birthday, and you'd rather not shop for it yourself. Here's how that goes with
Courier.

1. **You add Courier to Claude.** You paste one address into Claude's settings. This only happens once.
2. **You ask.** "Find me a jazz record under $40 at Juniper Records and buy it."
3. **PayPal confirms it's you.** The first time, Courier opens and you sign in with PayPal. Courier only needs to know
   you're a real, verified adult.
4. **You name your courier.** A courier is your AI with its own ID card. Say you call yours Juno.
5. **You write Juno a ticket.** It's like a note you'd give someone running an errand: "Jazz records for my dad, $60 in
   total, $40 at most per item, back by Sunday."
6. **You save PayPal once.** PayPal asks if this errand can pay without asking each time. You agree.
7. **Juno does the shopping.** Back in Claude, Juno searches the shop, picks a record, pays and gives you a receipt. You
   don't see a checkout page.
8. **If something's off the ticket, Juno asks.** Say Juno wants to add a slipmat, which isn't a jazz record. A yes-or-no
   question appears in your chat.
9. **If it breaks the rules, the answer is no.** A $149 turntable is over the $40 limit, so it's refused without anyone
   being asked.
10. **The shop knows who it's dealing with.** It sees that a verified courier is shopping and what it's allowed to do,
    but Courier doesn't give it your name.
11. **You stay in charge.** Every step shows up in your Courier home, and you can call Juno back at any time. When the
    errand ends, the saved PayPal is removed.

That's the whole idea: one ticket, then it just happens. To try it yourself, follow the steps under
[Try it](README.md#try-it). You won't need any accounts or keys, because the demo uses a pretend PayPal.

## What works today

Everything in the story is built and passes our automated tests using a pretend PayPal. The real-PayPal status is at the
end of this section.

**For the person**

| Feature             | What it does                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| PayPal sign-in      | Confirms you're real, and turns away unverified accounts and under-18s                                                                |
| Couriers            | Your AI gets a name, a colour and an ID card, and you can have several                                                                |
| Errand tickets      | Set what it's for, the total budget, the limit per item and when it ends                                                              |
| Works inside Claude | Claude connects to Courier by itself, from the shop's address                                                                         |
| Errand room         | Send a courier shopping from the Courier website, with no Claude setup                                                                |
| Asking first        | Off-ticket purchases get a question in the chat, or a link if the chat app can't ask. One yes covers those items for the whole errand |
| Pay without asking  | Save PayPal once for an errand, and purchases inside the limits just go through                                                       |
| Pay by link         | Without a saved PayPal, the courier sends a link and you approve the payment                                                          |
| Refundable bond     | An optional $5 hold on your PayPal. You get it back unless the shop reports abuse                                                     |
| Call back           | Ends an errand within seconds                                                                                                         |
| Errand history      | Shows every step a courier took and what it spent                                                                                     |

**For the shop**

| Feature            | What it does                                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------------------------------- |
| Demo shop          | Juniper Records, a pretend record shop that couriers can browse and buy from                                    |
| What the shop sees | Who's shopping, their orders, signed proof of what each was allowed to do, and a button to report a bad courier |
| Release the bots   | Eight attacks on the shop, like fake IDs and overspending, that you can watch get stopped live                  |

**How much is proven on real PayPal**

One full purchase has run with real Claude and the PayPal test environment, using sign-in, a ticket and a payment link.
That was before our latest cleanup, so it needs repeating. Pay without asking and the bond have only ever run on the
pretend PayPal, and Pay without asking is the main promise of the product, so testing it is the most urgent job. No real
money is involved at any point.

## What's next

We're on a tight timeline, so the near-term list is short.

**Next**

- **Group buying (Courier Runs).** Several people's couriers chip in and buy one thing together, like a family splitting
  a $120 gift. The landing page already advertises this, so we either build it or take that section down. The first
  version is estimated at 3–4 days.
- **Wait and ping.** Some chat apps can't show a yes-or-no question, so today the courier stops and sends a link.
  Instead, it would wait and ping you, then carry on once you answer.

**Final polish**

- **Final copy.** Get rid of any wording that reads as low effort or AI-generated.
- **Final branding.** Settle the look of the whole product.
- **Optimized UX.** Smooth out the full flow, from end to end.
- **Final positioning.** Settle how we describe Courier and who it's for.

**Later**

- **More shops.** Courier only knows the one demo shop today. Real shops would need a way to sign up, and PayPal would
  need to approve us to charge on their behalf.
- **Getting ready for real use.** This includes a login on the shop's dashboard and a database built for more than one
  server.
- **Working with other agent standards.** These are newer protocols for AI agents to prove what they're allowed to do
  and to hand tasks to each other.

**Still to decide:** does group buying ship in the first release?
