-- CreateTable
CREATE TABLE "WhatsappConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "groupId" TEXT,
    "groupName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SentOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappConfig_shop_key" ON "WhatsappConfig"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "SentOrder_shop_orderId_key" ON "SentOrder"("shop", "orderId");
