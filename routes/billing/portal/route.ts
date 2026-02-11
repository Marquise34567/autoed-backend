import { NextRequest } from 'next/server'
import Stripe from 'stripe'
import admin from '@/lib/firebase-admin'

export const runtime = 'nodejs'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2022-11-15' })

export async function POST(req: NextRequest){
  try {
    const { uid } = await req.json()
    if (!uid) return new Response('Missing uid', { status: 400 })
    const userDoc = await admin.firestore().collection('users').doc(uid).get()
    const user = userDoc.data()
    if (!user || !user.stripeCustomerId) return new Response('No customer', { status: 400 })
    const origin = process.env.APP_ORIGIN || process.env.APP_URL || ''
    const session = await stripe.billingPortal.sessions.create({ customer: user.stripeCustomerId, return_url: `${origin}/editor` })
    return new Response(JSON.stringify({ url: session.url }), { status: 200 })
  } catch (e) {
    console.error('[billing] portal error', e)
    return new Response('portal error', { status: 500 })
  }
}
