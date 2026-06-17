import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

interface Params {
  params: { id: string };
}

const voteSchema = z.object({
  type: z.enum(['UPVOTE', 'DOWNVOTE']),
});

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const user = await getCurrentUser(request);

    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 },
      );
    }

    const parsed = voteSchema.parse(await request.json());

    const idea = await prisma.idea.findUnique({
      where: { id: params.id },
      select: { id: true },
    });

    if (!idea) {
      return NextResponse.json({ error: 'Idea not found' }, { status: 404 });
    }

    const vote = await prisma.vote.upsert({
      where: {
        userId_ideaId: {
          userId: user.id,
          ideaId: params.id,
        },
      },
      update: {
        type: parsed.type,
      },
      create: {
        userId: user.id,
        ideaId: params.id,
        type: parsed.type,
      },
    });

    return NextResponse.json({ vote }, { status: 200 });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation failed', details: error.errors },
        { status: 422 },
      );
    }

    console.error(`POST /api/ideas/${params.id}/vote failed:`, error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
}
