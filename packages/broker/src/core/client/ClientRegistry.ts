import type { ClientID } from '../types';
import type { BrokerClient } from './BrokerClient';

/**
 * ClientRegistry - Manages registered clients
 *
 * Responsibilities:
 * - Register/unregister clients
 * - Track active clients
 * - Provide client lookup
 *
 * Used for observability and DevTools integration
 */
export class ClientRegistry<T extends string, P extends Record<T, any>> {
  #clients = new Map<ClientID, BrokerClient<T, P>>();
  #connectedAt = new Map<ClientID, number>();

  /**
   * Register a client
   */
  register(client: BrokerClient<T, P>): void {
    this.#clients.set(client.id, client);
    this.#connectedAt.set(client.id, Date.now());
  }

  /**
   * Unregister a client
   */
  unregister(clientId: ClientID): void {
    this.#clients.delete(clientId);
    this.#connectedAt.delete(clientId);
  }

  /**
   * Get the timestamp when a client registered (Unix ms)
   */
  getConnectedAt(clientId: ClientID): number | undefined {
    return this.#connectedAt.get(clientId);
  }

  /**
   * Get client by ID
   */
  get(clientId: ClientID): BrokerClient<T, P> | undefined {
    return this.#clients.get(clientId);
  }

  /**
   * Check if client is registered
   */
  has(clientId: ClientID): boolean {
    return this.#clients.has(clientId);
  }

  /**
   * Get all registered clients
   */
  getAll(): BrokerClient<T, P>[] {
    return Array.from(this.#clients.values());
  }

  /**
   * Get all client IDs
   */
  getAllIds(): ClientID[] {
    return Array.from(this.#clients.keys());
  }

  /**
   * Clear all clients
   */
  clear(): void {
    this.#clients.clear();
    this.#connectedAt.clear();
  }

  /**
   * Get number of registered clients
   */
  get size(): number {
    return this.#clients.size;
  }
}
