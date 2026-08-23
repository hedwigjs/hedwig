/**
 * Стресс-тест MessageBroker для получения максимальной производительности
 * Этот тест воспроизводит результаты 5M+ events/sec из отчета
 */

const { BrokerCore } = require('../dist/core/BrokerCore');
const { InMemoryClient } = require('../dist/client/InMemoryClient');

console.log('💥 СТРЕСС-ТЕСТ MessageBroker - Воспроизведение результатов отчета 💥\n');

function stressTest() {
  const core = new BrokerCore();
  const clientCount = 100;
  const eventsPerClient = 1000;
  const clients = [];
  let receivedCount = 0;
  let errorCount = 0;

  console.log(`🔥 Создаем ${clientCount} клиентов...`);

  // Создаем много клиентов
  for (let i = 0; i < clientCount; i++) {
    try {
      const client = new InMemoryClient(`stress-client-${i}`, core);
      clients.push(client);

      // Подписка на события с обработкой ошибок
      client.on('stress.test.v1', (event) => {
        try {
          receivedCount++;
          // Имитируем минимальную обработку для максимальной производительности
        } catch (e) {
          errorCount++;
        }
      });
    } catch (e) {
      errorCount++;
      console.error(`Ошибка создания клиента ${i}:`, e.message);
    }
  }

  console.log(`✅ Создано клиентов: ${clients.length}`);
  console.log(`🚀 Начинаем стресс-тест: ${eventsPerClient} событий от каждого клиента...`);

  const startTime = Date.now();
  const startMemory = process.memoryUsage();

  // Каждый клиент отправляет много событий (multicast через emit)
  clients.forEach((client, clientIndex) => {
    try {
      for (let i = 0; i < eventsPerClient; i++) {
        client.emit('stress.test.v1', {
          id: clientIndex * eventsPerClient + i,
          clientId: clientIndex,
          timestamp: Date.now(),
          payload: `Event ${i} from client ${clientIndex}`,
        });
      }
    } catch (e) {
      errorCount++;
      console.error(`Ошибка отправки от клиента ${clientIndex}:`, e.message);
    }
  });

  // Даем время на обработку
  setTimeout(() => {
    const endTime = Date.now();
    const endMemory = process.memoryUsage();
    const duration = endTime - startTime;

    const totalSent = clientCount * eventsPerClient;
    const expectedReceived = totalSent * (clientCount - 1); // каждый получает от всех кроме себя
    const throughput = Math.round(receivedCount / (duration / 1000));
    const deliveryRate = ((receivedCount / expectedReceived) * 100).toFixed(2);
    const memoryIncrease = (endMemory.heapUsed - startMemory.heapUsed) / 1024 / 1024;

    console.log(`\n📊 РЕЗУЛЬТАТЫ СТРЕСС-ТЕСТА (воспроизведение отчета):`);
    console.log(`  🎯 Клиентов: ${clientCount}`);
    console.log(`  📤 Отправлено событий: ${totalSent.toLocaleString()}`);
    console.log(`  📥 Ожидалось получить: ${expectedReceived.toLocaleString()}`);
    console.log(`  ✅ Фактически получено: ${receivedCount.toLocaleString()}`);
    console.log(`  🎯 Процент доставки: ${deliveryRate}%`);
    console.log(`  ⚡ Пропускная способность: ${throughput.toLocaleString()} events/sec`);
    console.log(`  ⏱️  Время выполнения: ${duration}ms`);
    console.log(`  🧠 Прирост памяти: ${memoryIncrease.toFixed(2)}MB`);
    console.log(`  ❌ Ошибок: ${errorCount}`);
    console.log(`  💾 Память на событие: ${((memoryIncrease * 1024) / totalSent).toFixed(3)}KB`);

    // Проверяем соответствие результатам отчета
    console.log(`\n🎯 СООТВЕТСТВИЕ ОТЧЕТУ:`);
    console.log(`  📊 Ожидаемая производительность: ~5,000,000 events/sec`);
    console.log(`  📊 Фактическая производительность: ${throughput.toLocaleString()} events/sec`);
    console.log(
      `  📊 Соответствие: ${throughput >= 5000000 ? '✅ СООТВЕТСТВУЕТ' : '⚠️ НИЖЕ ОЖИДАЕМОГО'}`,
    );

    core.destroy();
    process.exit(0);
  }, 1000);
}

// Запускаем тест
console.log('🎬 Запуск стресс-теста для воспроизведения результатов отчета...\n');
stressTest();
