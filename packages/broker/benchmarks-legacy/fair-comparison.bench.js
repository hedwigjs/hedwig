/**
 * Честное сравнение MessageBroker vs EventEmitter
 * С правильной настройкой подписок для обоих
 */

const { BrokerCore } = require('../dist/core/BrokerCore');
const { InMemoryClient } = require('../dist/client/InMemoryClient');
const { EventEmitter } = require('events');

console.log('🔬 ЧЕСТНОЕ СРАВНЕНИЕ: MessageBroker vs EventEmitter 🔬\n');

function testEventEmitterCorrect() {
  console.log('📊 Тестируем EventEmitter (ИСПРАВЛЕННАЯ версия)...');

  const emitters = [];
  const clientCount = 100;
  const eventsPerClient = 1000;
  let receivedCount = 0;

  // ШАҐГ 1: Создаем ВСЕ emitters
  for (let i = 0; i < clientCount; i++) {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(clientCount);
    emitters.push(emitter);
  }

  // ШАГ 2: Настраиваем подписки между ВСЕМИ
  emitters.forEach((emitter, i) => {
    emitters.forEach((otherEmitter, j) => {
      if (i !== j) {
        otherEmitter.on('test-event', () => {
          receivedCount++;
        });
      }
    });
  });

  const startTime = Date.now();
  const startMemory = process.memoryUsage();

  // Отправляем события
  emitters.forEach((emitter, emitterIndex) => {
    for (let i = 0; i < eventsPerClient; i++) {
      emitter.emit('test-event', {
        id: emitterIndex * eventsPerClient + i,
        clientId: emitterIndex,
        payload: `Event ${i} from emitter ${emitterIndex}`,
      });
    }
  });

  setTimeout(() => {
    const endTime = Date.now();
    const endMemory = process.memoryUsage();
    const duration = endTime - startTime;

    const totalSent = clientCount * eventsPerClient;
    const expectedReceived = totalSent * (clientCount - 1);
    const throughput = Math.round(receivedCount / (duration / 1000));
    const memoryIncrease = (endMemory.heapUsed - startMemory.heapUsed) / 1024 / 1024;

    console.log(`\n📊 РЕЗУЛЬТАТЫ EventEmitter (исправленный):`);
    console.log(`  🎯 Emitters: ${clientCount}`);
    console.log(`  📤 Отправлено событий: ${totalSent.toLocaleString()}`);
    console.log(`  📥 Ожидалось получить: ${expectedReceived.toLocaleString()}`);
    console.log(`  ✅ Фактически получено: ${receivedCount.toLocaleString()}`);
    console.log(`  🎯 Процент доставки: ${((receivedCount / expectedReceived) * 100).toFixed(2)}%`);
    console.log(`  ⚡ Пропускная способность: ${throughput.toLocaleString()} events/sec`);
    console.log(`  ⏱️  Время выполнения: ${duration}ms`);
    console.log(`  🧠 Прирост памяти: ${memoryIncrease.toFixed(2)}MB`);

    // Теперь тестируем MessageBroker
    setTimeout(() => testMessageBroker(throughput, memoryIncrease, duration), 100);
  }, 100);
}

function testMessageBroker(emitterThroughput, emitterMemory, emitterDuration) {
  console.log(`\n📊 Тестируем MessageBroker...`);

  const core = new BrokerCore();
  const clients = [];
  const clientCount = 100;
  const eventsPerClient = 1000;
  let receivedCount = 0;

  // Создаем клиенты
  for (let i = 0; i < clientCount; i++) {
    const client = new InMemoryClient(`client-${i}`, core);
    clients.push(client);

    client.on('test-event', () => {
      receivedCount++;
    });
  }

  const startTime = Date.now();
  const startMemory = process.memoryUsage();

  // Отправляем события (emit для multicast)
  clients.forEach((client, clientIndex) => {
    for (let i = 0; i < eventsPerClient; i++) {
      client.emit('test-event', {
        id: clientIndex * eventsPerClient + i,
        clientId: clientIndex,
        payload: `Event ${i} from client ${clientIndex}`,
      });
    }
  });

  setTimeout(() => {
    const endTime = Date.now();
    const endMemory = process.memoryUsage();
    const duration = endTime - startTime;

    const totalSent = clientCount * eventsPerClient;
    const expectedReceived = totalSent * (clientCount - 1);
    const throughput = Math.round(receivedCount / (duration / 1000));
    const memoryIncrease = (endMemory.heapUsed - startMemory.heapUsed) / 1024 / 1024;

    console.log(`\n📊 РЕЗУЛЬТАТЫ MessageBroker:`);
    console.log(`  🎯 Клиентов: ${clientCount}`);
    console.log(`  📤 Отправлено событий: ${totalSent.toLocaleString()}`);
    console.log(`  📥 Ожидалось получить: ${expectedReceived.toLocaleString()}`);
    console.log(`  ✅ Фактически получено: ${receivedCount.toLocaleString()}`);
    console.log(`  🎯 Процент доставки: ${((receivedCount / expectedReceived) * 100).toFixed(2)}%`);
    console.log(`  ⚡ Пропускная способность: ${throughput.toLocaleString()} events/sec`);
    console.log(`  ⏱️  Время выполнения: ${duration}ms`);
    console.log(`  🧠 Прирост памяти: ${memoryIncrease.toFixed(2)}MB`);

    // Честное сравнение
    console.log(`\n🏆 ЧЕСТНОЕ СРАВНЕНИЕ:`);
    console.log(`  ⚡ Скорость:`);
    console.log(
      `     EventEmitter: ${emitterThroughput.toLocaleString()} events/sec за ${emitterDuration}ms`,
    );
    console.log(`     MessageBroker:  ${throughput.toLocaleString()} events/sec за ${duration}ms`);
    console.log(`     Разница: ${(emitterThroughput / throughput).toFixed(2)}x`);
    console.log(`  💾 Память:`);
    console.log(`     EventEmitter: ${emitterMemory.toFixed(2)}MB`);
    console.log(`     MessageBroker:  ${memoryIncrease.toFixed(2)}MB`);
    console.log(`     Разница: ${(memoryIncrease / emitterMemory).toFixed(2)}x`);

    console.log(`\n🎯 В ЧЕМ НАСТОЯЩАЯ РАЗНИЦА:`);
    console.log(`  1. 📦 Архитектура:`);
    console.log(`     • EventEmitter: decentralized, N×N связей, сложность O(N²)`);
    console.log(`     • MessageBroker: centralized hub, одна точка, сложность O(N)`);
    console.log(`  2. 🔒 Безопасность:`);
    console.log(`     • EventEmitter: нет контроля доступа`);
    console.log(`     • MessageBroker: встроенный ACL, кто кому может слать`);
    console.log(`  3. 🛠️ DevTools:`);
    console.log(`     • EventEmitter: console.log для отладки`);
    console.log(`     • MessageBroker: визуальные DevTools, мониторинг`);
    console.log(`  4. 📘 TypeScript:`);
    console.log(`     • EventEmitter: базовая типизация`);
    console.log(`     • MessageBroker: строгая типизация событий и payload`);
    console.log(`  5. 🏗️ Для микрофронтендов:`);
    console.log(`     • EventEmitter: требует обертки и инфраструктуры`);
    console.log(`     • MessageBroker: готовые клиенты для разных сценариев`);

    console.log(`\n💡 ВЫВОД:`);
    console.log(`  EventEmitter быстрее и легче, но это примитив.`);
    console.log(`  MessageBroker - это production-ready решение для микрофронтендов.`);

    core.destroy();
    process.exit(0);
  }, 100);
}

// Запускаем честное сравнение
testEventEmitterCorrect();
