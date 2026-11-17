CREATE TYPE "PortalRole" AS ENUM ('owner', 'employee');

CREATE TABLE "portal_members" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "PortalRole" NOT NULL DEFAULT 'employee',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "link_hash" TEXT,
    "link_expires_at" TIMESTAMPTZ,
    "last_link_at" TIMESTAMPTZ,
    CONSTRAINT "portal_members_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "portal_sessions" (
    "token_hash" TEXT NOT NULL,
    "member_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "portal_sessions_pkey" PRIMARY KEY ("token_hash"),
    CONSTRAINT "portal_sessions_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "portal_members"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "portal_members_email_key" ON "portal_members"("email");
CREATE UNIQUE INDEX "portal_members_link_hash_key" ON "portal_members"("link_hash");
CREATE INDEX "portal_sessions_member_id_expires_at_idx" ON "portal_sessions"("member_id", "expires_at");
