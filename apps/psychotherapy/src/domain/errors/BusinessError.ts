import { AppError } from './AppError';

export class BusinessError extends AppError {
    constructor(message: string) {
        super(message, 422); // Unprocessable Entity is often good for business rule violations
        this.name = 'BusinessError';
    }
}
