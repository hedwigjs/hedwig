/**
 * Benchmark тесты производительности MessageBroker
 * Конвертировано из TypeScript в JavaScript для прямого запуска
 */

const { BrokerCore } = require('../dist/core/BrokerCore');
const { InMemoryClient } = require('../dist/client/InMemoryClient');
const Benchmark = require('benchmark');

console.log('🚀 MessageBroker - Throughput Benchmarks\n');

async function runBenchmarks() {
  console.log('=== Test 1: Event Creation Performance ===\n');

  const core1 = new BrokerCore();
  const client1 = new InMemoryClient('sender', core1);
  const client2 = new InMemoryClient('receiver', core1);

  const suite = new Benchmark.Suite();

  suite
    .add('createEvent - simple payload', () => {
      client1.request('receiver', 'test.event.v1', {
        id: 1,
        data: 'test',
      });
    })
    .add('createEvent - complex payload', () => {
      client1.request('receiver', 'heavy.event.v1', {
        payload: {
          users: Array(100)
            .fill(0)
            .map((_, i) => ({ id: i, name: `User${i}` })),
          metadata: { timestamp: Date.now(), version: '1.0' },
        },
      });
    })
    .on('complete', function () {
      console.log('Results:');
      this.forEach((benchmark) => {
        console.log(`  ${benchmark.name}: ${Math.round(benchmark.hz).toLocaleString()} ops/sec`);
      });

      core1.destroy();

      // Запускаем следующий тест
      setTimeout(() => runEventDeliveryTest(), 100);
    })
    .run({ async: false });
}

function runEventDeliveryTest() {
  console.log('\n=== Test 2: Event Delivery Performance ===\n');

  const core = new BrokerCore();
  const client1 = new InMemoryClient('sender', core);
  const client2 = new InMemoryClient('receiver', core);

  let receivedCount = 0;
  const totalEvents = 10000;

  // Подписываемся на события
  client2.on('test.event.v1', () => {
    receivedCount++;
  });

  const startTime = Date.now();

  // Отправляем события пакетом
  for (let i = 0; i < totalEvents; i++) {
    client1.request('receiver', 'test.event.v1', {
      id: i,
      data: `test-${i}`,
    });
  }

  // Измеряем время доставки всех событий
  setTimeout(() => {
    const endTime = Date.now();
    const duration = endTime - startTime;
    const throughput = Math.round(receivedCount / (duration / 1000));

    console.log('Results:');
    console.log(`  События отправлено: ${totalEvents}`);
    console.log(`  События получено: ${receivedCount}`);
    console.log(`  Время выполнения: ${duration.toFixed(2)}ms`);
    console.log(`  Пропускная способность: ${throughput.toLocaleString()} events/sec`);
    console.log(`  Статус: ${receivedCount === totalEvents ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`  Порог: ${throughput > 50000 ? '✅ > 50k events/sec' : '⚠️ < 50k events/sec'}`);

    core.destroy();

    // Запускаем следующий тест
    setTimeout(() => runMemoryTest(), 100);
  }, 100);
}

function runMemoryTest() {
  console.log('\n=== Test 3: Memory Usage under Load ===\n');

  const core = new BrokerCore();
  const client1 = new InMemoryClient('sender', core);

  const initialMemory = process.memoryUsage().heapUsed;

  // Создаем много подписчиков
  const clients = [];
  for (let i = 0; i < 1000; i++) {
    const client = new InMemoryClient(`client-${i}`, core);
    clients.push(client);
  }

  // Подписываем всех на события
  clients.forEach((client) => {
    client.on('test.event.v1', () => {});
  });

  // Отправляем события
  for (let i = 0; i < 1000; i++) {
    client1.emit('test.event.v1', { id: i, data: 'test' });
  }

  const finalMemory = process.memoryUsage().heapUsed;
  const memoryIncrease = finalMemory - initialMemory;

  console.log('Results:');
  console.log(`  Начальная память: ${(initialMemory / 1024 / 1024).toFixed(2)}MB`);
  console.log(`  Конечная память: ${(finalMemory / 1024 / 1024).toFixed(2)}MB`);
  console.log(`  Прирост памяти: ${(memoryIncrease / 1024 / 1024).toFixed(2)}MB`);
  console.log(
    `  Статус: ${memoryIncrease / 1024 / 1024 < 10 ? '✅ PASS (< 10MB)' : '⚠️ WARNING (> 10MB)'}`,
  );

  core.destroy();

  // Запускаем следующий тест
  setTimeout(() => runConcurrentTest(), 100);
}

function runConcurrentTest() {
  console.log('\n=== Test 4: Concurrent Publishers Performance ===\n');

  const core = new BrokerCore();
  const client2 = new InMemoryClient('receiver', core);

  const publishers = 50;
  const eventsPerPublisher = 100;
  let totalReceived = 0;
  const expectedTotal = publishers * eventsPerPublisher;

  // Один получатель для всех событий
  client2.on('test.event.v1', () => {
    totalReceived++;
  });

  const startTime = Date.now();

  // Создаем множественных отправителей
  const senders = Array(publishers)
    .fill(0)
    .map((_, i) => new InMemoryClient(`sender-${i}`, core));

  // Каждый отправитель шлет события параллельно
  Promise.all(
    senders.map(async (sender, senderIndex) => {
      for (let i = 0; i < eventsPerPublisher; i++) {
        await sender.request('receiver', 'test.event.v1', {
          id: senderIndex * eventsPerPublisher + i,
          data: `sender-${senderIndex}-event-${i}`,
        });
      }
    }),
  ).then(() => {
    setTimeout(() => {
      const endTime = Date.now();
      const duration = endTime - startTime;
      const throughput = Math.round(totalReceived / (duration / 1000));

      console.log('Results:');
      console.log(`  Отправители: ${publishers}`);
      console.log(`  События на отправителя: ${eventsPerPublisher}`);
      console.log(`  Всего событий: ${expectedTotal}`);
      console.log(`  Получено событий: ${totalReceived}`);
      console.log(`  Время: ${duration.toFixed(2)}ms`);
      console.log(`  Throughput: ${throughput.toLocaleString()} events/sec`);
      console.log(`  Статус: ${totalReceived === expectedTotal ? '✅ PASS' : '❌ FAIL'}`);
      console.log(`  Порог: ${throughput > 20000 ? '✅ > 20k events/sec' : '⚠️ < 20k events/sec'}`);

      core.destroy();

      console.log('\n✅ Все тесты завершены!\n');
      process.exit(0);
    }, 200);
  });
}

// Запускаем все тесты последовательно
runBenchmarks();
